const { MOVE_TURN_MS } = require('../config');

class MatchmakingQueue {
  constructor(io) {
    this.io = io;
    this.waitingPlayers = new Map(); // socketId -> player data
    this.activeBattles = new Map(); // battleId -> battle data
    this.spectators = new Map(); // battleId -> Set of spectator sockets
  }

  clearMoveTimer(room) {
    if (room.moveTimer) {
      clearTimeout(room.moveTimer);
      room.moveTimer = null;
    }
  }

  scheduleMoveTimer(battleId) {
    const room = this.activeBattles.get(battleId);
    if (!room) return;
    this.clearMoveTimer(room);
    room.moveTimer = setTimeout(() => {
      room.moveTimer = null;
      const r = this.activeBattles.get(battleId);
      if (!r || r.battle.isFinished()) return;
      if (r.p1Choice && r.p2Choice) return;
      if (!r.p1Choice) r.p1Choice = { type: 'move', moveIndex: 0 };
      if (!r.p2Choice) r.p2Choice = { type: 'move', moveIndex: 0 };
      this.emitToBattle(battleId, 'moveStatus', { p1Ready: true, p2Ready: true, timedOut: true });
      this.finishTurnWithChoices(battleId, r);
    }, MOVE_TURN_MS);
  }

  finishTurnWithChoices(battleId, room) {
    if (!room.p1Choice || !room.p2Choice) return;
    this.clearMoveTimer(room);
    this.emitToBattle(battleId, 'turnResolving', { message: 'Turn processed.' });

    const events = room.battle.processTurn(room.p1Choice, room.p2Choice);
    room.allEvents.push(...events);
    room.p1Choice = null;
    room.p2Choice = null;

    const state = room.battle.getState();
    this.emitToBattle(battleId, 'battleEvents', events);
    this.emitToBattle(battleId, 'battleState', state);

    if (room.battle.isFinished()) {
      this.finishBattle(battleId);
    } else {
      this.emitToBattle(battleId, 'requestMove', { ...state, moveTurnMs: MOVE_TURN_MS });
      this.scheduleMoveTimer(battleId);
    }
  }

  addPlayer(socket, user, team) {
    const playerId = socket.id;
    const playerData = {
      socket,
      user,
      team,
      queueTime: Date.now(),
      rating: user.rating || 1000
    };

    this.waitingPlayers.set(playerId, playerData);
    socket.data.inQueue = true;
    socket.data.queueJoinTime = Date.now();

    // Try to find a match immediately
    this.tryMatchmaking();

    // Update queue status for all players
    this.updateQueueStatus();

    return playerData;
  }

  removePlayer(socketId) {
    const player = this.waitingPlayers.get(socketId);
    if (player) {
      player.socket.data.inQueue = false;
      player.socket.data.queueJoinTime = null;
      this.waitingPlayers.delete(socketId);
      this.updateQueueStatus();
    }
    return player;
  }

  tryMatchmaking() {
    if (this.waitingPlayers.size < 2) return;

    const players = Array.from(this.waitingPlayers.values());
    
    // Sort by queue time (longest waiting first)
    players.sort((a, b) => a.queueTime - b.queueTime);

    // Try to find the best match for the first player
    const player1 = players[0];
    const bestMatch = this.findBestMatch(player1, players.slice(1));

    if (bestMatch) {
      this.createBattle(player1, bestMatch);
    }
  }

  findBestMatch(player1, candidates) {
    const maxRatingDiff = 200; // Maximum ELO difference for matching
    const maxWaitTime = 30000; // 30 seconds before loosening restrictions

    const waitTime = Date.now() - player1.queueTime;
    const currentMaxDiff = waitTime > maxWaitTime ? maxRatingDiff * 2 : maxRatingDiff;

    // Find candidates within rating range
    const validCandidates = candidates.filter(p => 
      Math.abs(p.rating - player1.rating) <= currentMaxDiff
    );

    if (validCandidates.length === 0) {
      // If no candidates in range, pick the closest one
      return candidates.reduce((best, current) => {
        const bestDiff = Math.abs(best.rating - player1.rating);
        const currentDiff = Math.abs(current.rating - player1.rating);
        return currentDiff < bestDiff ? current : best;
      });
    }

    // Return the candidate with closest rating and longest wait time
    return validCandidates.reduce((best, current) => {
      const ratingDiff = Math.abs(current.rating - player1.rating) - Math.abs(best.rating - player1.rating);
      if (ratingDiff !== 0) return ratingDiff < 0 ? current : best;
      
      // If ratings are equally close, prefer longer waiting
      return current.queueTime < best.queueTime ? current : best;
    });
  }

  createBattle(player1, player2) {
    const Battle = require('../engine/battle/Battle');
    const battleId = `${player1.socket.id}-${player2.socket.id}`;
    
    // Remove both players from queue
    this.waitingPlayers.delete(player1.socket.id);
    this.waitingPlayers.delete(player2.socket.id);

    // Mark as in battle
    player1.socket.data.inBattle = true;
    player1.socket.data.inQueue = false;
    player1.socket.data.battleId = battleId;
    player2.socket.data.inBattle = true;
    player2.socket.data.inQueue = false;
    player2.socket.data.battleId = battleId;

    // Create battle instance
    const p1BattlePlayer = { name: player1.user.username, team: player1.team };
    const p2BattlePlayer = { name: player2.user.username, team: player2.team };
    const battle = new Battle(p1BattlePlayer, p2BattlePlayer);

    // Store battle data
    this.activeBattles.set(battleId, {
      battle,
      p1Socket: player1.socket,
      p2Socket: player2.socket,
      p1Choice: null,
      p2Choice: null,
      moveTimer: null,
      allEvents: [],
      startTime: Date.now()
    });

    // Notify players
    const state = battle.getState();
    player1.socket.emit('battleStart', { battleId, state, youAre: 'p1', moveTurnMs: MOVE_TURN_MS });
    player2.socket.emit('battleStart', { battleId, state, youAre: 'p2', moveTurnMs: MOVE_TURN_MS });

    // Request first moves + start pick timer (defaults to move 0 if expired)
    this.emitToBattle(battleId, 'requestMove', { ...state, moveTurnMs: MOVE_TURN_MS });
    this.scheduleMoveTimer(battleId);

    // Update queue status
    this.updateQueueStatus();

    console.log(`Battle created: ${player1.user.username} vs ${player2.user.username}`);
  }

  emitToBattle(battleId, event, payload) {
    const room = this.activeBattles.get(battleId);
    if (!room) return;

    if (room.p1Socket?.connected) room.p1Socket.emit(event, payload);
    if (room.p2Socket?.connected) room.p2Socket.emit(event, payload);

    // Also emit to spectators
    const spectators = this.spectators.get(battleId);
    if (spectators) {
      spectators.forEach(socket => {
        if (socket.connected) socket.emit(event, payload);
      });
    }
  }

  addSpectator(battleId, socket) {
    if (!this.spectators.has(battleId)) {
      this.spectators.set(battleId, new Set());
    }
    this.spectators.get(battleId).add(socket);
    socket.data.spectating = battleId;

    // Send current battle state to new spectator
    const room = this.activeBattles.get(battleId);
    if (room) {
      socket.emit('spectateStart', { battleId, state: room.battle.getState() });
    }
  }

  removeSpectator(battleId, socket) {
    const spectators = this.spectators.get(battleId);
    if (spectators) {
      spectators.delete(socket);
      if (spectators.size === 0) {
        this.spectators.delete(battleId);
      }
    }
    socket.data.spectating = null;
  }

  updateQueueStatus() {
    const queueInfo = {
      playersInQueue: this.waitingPlayers.size,
      activeBattles: this.activeBattles.size,
      averageWaitTime: this.calculateAverageWaitTime(),
      onlinePlayers: this.getOnlinePlayerCount()
    };

    // Emit to all connected clients
    this.io.emit('queueStatus', queueInfo);
  }

  calculateAverageWaitTime() {
    if (this.waitingPlayers.size === 0) return 0;
    
    const now = Date.now();
    const totalWaitTime = Array.from(this.waitingPlayers.values())
      .reduce((sum, player) => sum + (now - player.queueTime), 0);
    
    return Math.round(totalWaitTime / this.waitingPlayers.size / 1000); // seconds
  }

  getOnlinePlayerCount() {
    return this.io.sockets.sockets.size;
  }

  getQueueList() {
    return Array.from(this.waitingPlayers.values()).map(player => ({
      username: player.user.username,
      rating: player.rating,
      waitTime: Math.round((Date.now() - player.queueTime) / 1000),
      teamSize: player.team.pokemon.length
    }));
  }

  getActiveBattles() {
    return Array.from(this.activeBattles.entries()).map(([battleId, room]) => ({
      battleId,
      player1: room.p1Socket.data.user?.username,
      player2: room.p2Socket.data.user?.username,
      duration: Math.round((Date.now() - room.startTime) / 1000),
      turn: room.battle.turn,
      spectators: this.spectators.get(battleId)?.size || 0
    }));
  }

  processTurn(battleId, socket, choice) {
    const room = this.activeBattles.get(battleId);
    if (!room) return false;

    if (socket === room.p1Socket) {
      if (room.p1Choice) return true;
      room.p1Choice = choice;
    } else if (socket === room.p2Socket) {
      if (room.p2Choice) return true;
      room.p2Choice = choice;
    } else {
      return false;
    }

    this.emitToBattle(battleId, 'moveStatus', {
      p1Ready: !!room.p1Choice,
      p2Ready: !!room.p2Choice,
      timedOut: false
    });

    if (room.p1Choice && room.p2Choice) {
      this.finishTurnWithChoices(battleId, room);
    }

    return true;
  }

  finishBattle(battleId) {
    const room = this.activeBattles.get(battleId);
    if (!room) return;

    this.clearMoveTimer(room);

    const { battle, p1Socket, p2Socket } = room;
    const winner = battle.winner;

    // Update user stats
    const UserManager = require('../engine/userManager');
    const p1User = p1Socket?.data?.user;
    const p2User = p2Socket?.data?.user;

    if (p1User && p2User) {
      const p1Won = winner === p1User.username;
      const p2Won = winner === p2User.username;

      // Update stats asynchronously
      UserManager.incrementMatches(p1User.id).catch(() => {});
      UserManager.incrementMatches(p2User.id).catch(() => {});
      if (p1Won) UserManager.incrementWin(p1User.id).catch(() => {});
      else UserManager.incrementLoss(p1User.id).catch(() => {});
      if (p2Won) UserManager.incrementWin(p2User.id).catch(() => {});
      else UserManager.incrementLoss(p2User.id).catch(() => {});
      UserManager.updateElo(p1User.id, p2User.id, p1Won).catch(() => {});
      UserManager.updateElo(p2User.id, p1User.id, p2Won).catch(() => {});

      // Record battle
      const p1Team = battle.player1.team.pokemon.map(p => p.name);
      const p2Team = battle.player2.team.pokemon.map(p => p.name);
      UserManager.recordBattle(p1User.id, p2User.id, p1Won ? p1User.id : p2User.id, battle.turn - 1, 
        JSON.stringify(p1Team), JSON.stringify(p2Team)).catch(() => {});

      // Record Pokemon usage
      const damageDone = {};
      const damageTaken = {};
      room.allEvents.forEach(e => {
        if (e.type === 'move' && e.damage != null) {
          damageDone[e.actor] = (damageDone[e.actor] || 0) + e.damage;
          damageTaken[e.target] = (damageTaken[e.target] || 0) + e.damage;
        }
      });

      p1Team.forEach(name => {
        UserManager.recordPokemonUsage(p1User.id, name, p1Won, damageDone[name] || 0, damageTaken[name] || 0).catch(() => {});
      });
      p2Team.forEach(name => {
        UserManager.recordPokemonUsage(p2User.id, name, p2Won, damageDone[name] || 0, damageTaken[name] || 0).catch(() => {});
      });
    }

    // Notify players and spectators
    this.emitToBattle(battleId, 'battleFinished', winner);

    // Clean up
    if (p1Socket) {
      p1Socket.data.inBattle = false;
      p1Socket.data.battleId = null;
    }
    if (p2Socket) {
      p2Socket.data.inBattle = false;
      p2Socket.data.battleId = null;
    }

    // Remove spectators
    const spectators = this.spectators.get(battleId);
    if (spectators) {
      spectators.forEach(socket => {
        socket.data.spectating = null;
        socket.emit('spectateEnd', { battleId, winner });
      });
      this.spectators.delete(battleId);
    }

    this.activeBattles.delete(battleId);
    this.updateQueueStatus();

    console.log(`Battle finished: ${winner} won`);
  }

  // Handle disconnections
  handleDisconnect(socket) {
    const playerId = socket.id;

    // Remove from queue if waiting
    if (socket.data.inQueue) {
      this.removePlayer(playerId);
    }

    // Handle battle disconnection
    if (socket.data.inBattle && socket.data.battleId) {
      const battleId = socket.data.battleId;
      const room = this.activeBattles.get(battleId);
      
      if (room) {
        this.clearMoveTimer(room);
        // Notify opponent
        const opponent = socket === room.p1Socket ? room.p2Socket : room.p1Socket;
        if (opponent?.connected) {
          opponent.emit('battleDisconnected', 'Opponent disconnected');
          opponent.data.inBattle = false;
          opponent.data.battleId = null;
        }

        // Clean up battle
        this.activeBattles.delete(battleId);
        this.updateQueueStatus();
      }
    }

    // Handle spectator disconnection
    if (socket.data.spectating) {
      this.removeSpectator(socket.data.spectating, socket);
    }
  }
}

module.exports = MatchmakingQueue;
