(function () {
  const API = window.location.origin;
  let username = '';
  let password = '';
  let speciesList = [];
  let socket = null;
  let youAre = 'p1';
  let battleState = null;
  let inQueue = false;
  let queueStartTime = null;
  let queueTimer = null;
  /** @type {string[]} */
  let currentTeam = [];
  let moveTurnMs = 45000;
  let moveCountdownId = null;
  /** Server accepted socket `login`; required before joinBattle. */
  let socketAuthOk = false;

  const $ = (id) => document.getElementById(id);

  const SCREEN_IDS = {
    boot: 'screen-boot',
    auth: 'screen-auth',
    lobby: 'screen-lobby',
    team: 'screen-team',
    battle: 'screen-battle'
  };

  function setScreen(screenName) {
    const targetId = SCREEN_IDS[screenName];
    if (!targetId) return;
    Object.values(SCREEN_IDS).forEach((id) => {
      const el = $(id);
      if (el) el.classList.add('hidden');
    });
    const el = $(targetId);
    if (el) el.classList.remove('hidden');
    if (screenName === 'lobby') showLobbyMain();
  }

  function showLobbyMain() {
    const main = $('lobby-panel-main');
    const spec = $('lobby-panel-spectator');
    if (main) main.classList.remove('hidden');
    if (spec) spec.classList.add('hidden');
  }

  function showLobbySpectator() {
    const main = $('lobby-panel-main');
    const spec = $('lobby-panel-spectator');
    if (main) main.classList.add('hidden');
    if (spec) spec.classList.remove('hidden');
  }

  fetch(API + '/api/auth/google-enabled')
    .then((r) => r.json())
    .then((data) => {
      const row = $('google-oauth-row');
      if (row && data.enabled) row.classList.remove('hidden');
    })
    .catch(() => {});

  function spriteUrl(id) {
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-i/red-blue/${id}.png`;
  }

  function clearMoveCountdown() {
    if (moveCountdownId) {
      clearInterval(moveCountdownId);
      moveCountdownId = null;
    }
    const t = $('battle-move-timer');
    if (t) t.textContent = '';
  }

  function startMoveCountdown(ms) {
    clearMoveCountdown();
    const end = Date.now() + ms;
    moveCountdownId = setInterval(() => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      const el = $('battle-move-timer');
      if (el) el.textContent = left > 0 ? `${left}s` : '';
      if (left <= 0) clearMoveCountdown();
    }, 300);
  }

  function appendMatrixLine(text, className) {
    const log = $('battle-matrix-log');
    if (!log) return;
    const p = document.createElement('p');
    p.className = 'matrix-line' + (className ? ' ' + className : '');
    p.textContent = text;
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
  }

  function effectivenessText(mult) {
    if (mult === 0) return "It doesn't affect the foe…";
    if (mult > 1) return "It's super effective!";
    if (mult < 1 && mult > 0) return "It's not very effective…";
    return '';
  }

  function effectivenessClass(mult) {
    if (mult === 0) return 'matrix-immune';
    if (mult > 1) return 'matrix-super';
    if (mult < 1 && mult > 0) return 'matrix-resist';
    return '';
  }

  function triggerBattleMotion(actorName, targetName) {
    if (youAre === 'spectator') return;
    const st = battleState;
    if (!st) return;
    const myActive = youAre === 'p1' ? st.p1Active : st.p2Active;
    const opActive = youAre === 'p1' ? st.p2Active : st.p1Active;
    const wPlayer = $('wrap-sprite-player');
    const wEnemy = $('wrap-sprite-enemy');
    if (!wPlayer || !wEnemy) return;
    const wrapFor = (name) => {
      if (name === myActive) return wPlayer;
      if (name === opActive) return wEnemy;
      return null;
    };
    wPlayer.classList.remove('sprite-lunge', 'sprite-hit');
    wEnemy.classList.remove('sprite-lunge', 'sprite-hit');
    const wa = wrapFor(actorName);
    const wt = wrapFor(targetName);
    if (wa) {
      void wa.offsetWidth;
      wa.classList.add('sprite-lunge');
    }
    if (wt) {
      void wt.offsetWidth;
      wt.classList.add('sprite-hit');
    }
    setTimeout(() => {
      wPlayer.classList.remove('sprite-lunge', 'sprite-hit');
      wEnemy.classList.remove('sprite-lunge', 'sprite-hit');
    }, 520);
  }

  setTimeout(async () => {
    try {
      const res = await fetch(API + '/api/me');
      const data = await res.json();
      if (data.ok && data.user?.username) {
        username = data.user.username;
        password = '';
        $('lobby-username').textContent = username;
        await loadLobbyData(true);
        setScreen('lobby');
        return;
      }
    } catch (err) {
      /* fall through */
    }
    setScreen('auth');
  }, 1400);

  $('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    username = $('input-username').value.trim();
    password = $('input-password').value;
    $('login-error').textContent = '';
    try {
      const res = await fetch(API + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.ok) {
        $('lobby-username').textContent = data.username;
        await loadLobbyData(false);
        setScreen('lobby');
      } else {
        $('login-error').textContent = data.error || 'Login failed';
      }
    } catch (err) {
      $('login-error').textContent = 'Network error';
    }
  });

  $('btn-register').addEventListener('click', async () => {
    username = $('input-username').value.trim();
    password = $('input-password').value;
    $('login-error').textContent = '';
    if (!username || !password) {
      $('login-error').textContent = 'Enter username and password';
      return;
    }
    try {
      const res = await fetch(API + '/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.ok) {
        $('lobby-username').textContent = data.username;
        await loadLobbyData(false);
        setScreen('lobby');
      } else {
        $('login-error').textContent = data.error || 'Registration failed';
      }
    } catch (err) {
      $('login-error').textContent = 'Network error';
    }
  });

  $('btn-google-login').addEventListener('click', () => {
    window.location.href = API + '/auth/google';
  });

  $('btn-logout').addEventListener('click', () => {
    username = '';
    password = '';
    if (socket) socket.disconnect();
    socket = null;
    setScreen('auth');
  });

  async function loadLobbyData(useSessionForTeam) {
    $('lobby-status').textContent = 'Loading...';
    try {
      const teamBody = useSessionForTeam ? {} : { username, password };
      const [speciesRes, teamRes, presetsRes] = await Promise.all([
        fetch(API + '/api/species'),
        fetch(API + '/api/me/team', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(teamBody)
        }),
        fetch(API + '/api/presets')
      ]);
      const speciesData = await speciesRes.json();
      speciesList = speciesData.species || [];
      let mySpecies = [];
      if (teamRes.ok) {
        const teamData = await teamRes.json();
        mySpecies = teamData.species || [];
        const tn = $('team-name-input');
        if (tn) tn.value = teamData.teamName || 'My team';
      }
      applyTeamSpecies(mySpecies);
      const presetsData = await presetsRes.json();
      renderPresetButtons(presetsData.presets || []);
      $('lobby-status').textContent = '';
      initSocket();
    } catch (err) {
      $('lobby-status').textContent = 'Failed to load.';
    }
  }

  function initSocket() {
    if (!socket) {
      socket = io(API);
      setupSocketHandlers();
    }
    socket.emit('login', { username, password });
  }

  /** Run callback after socket is connected and `login` has succeeded on the server. */
  function whenAuthenticated(cb) {
    if (!socket) initSocket();
    const schedule = () => {
      if (socketAuthOk) {
        cb();
        return;
      }
      socket.once('loginResult', (d) => {
        if (d.ok) cb();
      });
    };
    if (socket.connected) schedule();
    else socket.once('connect', schedule);
  }

  function setupSocketHandlers() {
    socket.on('connect', () => {
      socket.emit('login', { username, password });
    });

    socket.on('disconnect', () => {
      socketAuthOk = false;
    });

    socket.on('loginResult', (data) => {
      socketAuthOk = !!data.ok;
      if (data.ok) socket.emit('getQueueStatus');
    });

    socket.on('queueStatus', (status) => {
      updateLobbyStatus(status);
    });

    socket.on('queueList', (queueList) => {
      const el = $('queue-preview-list');
      if (!queueList || queueList.length === 0) {
        el.textContent = 'No queued players.';
        return;
      }
      el.innerHTML = queueList
        .slice(0, 8)
        .map((p) => `${p.username} (${p.rating}) - ${p.waitTime}s`)
        .join('<br>');
    });

    socket.on('queueJoined', (data) => {
      inQueue = true;
      queueStartTime = Date.now();
      showMatchmakingStatus(true);
      startQueueTimer();
      $('lobby-status').textContent = data.message;
    });

    socket.on('queueLeft', (data) => {
      inQueue = false;
      queueStartTime = null;
      showMatchmakingStatus(false);
      stopQueueTimer();
      $('lobby-status').textContent = data.message;
    });

    socket.on('battleStart', (data) => {
      inQueue = false;
      queueStartTime = null;
      showMatchmakingStatus(false);
      stopQueueTimer();
      youAre = data.youAre;
      battleState = data.state;
      if (data.moveTurnMs) moveTurnMs = data.moveTurnMs;
      setScreen('battle');
      $('battle-finished').classList.add('hidden');
      const mx = $('battle-matrix-log');
      if (mx) mx.innerHTML = '';
      const st = $('battle-status');
      if (st) {
        st.textContent = 'Choose a move.';
        st.classList.remove('turn-resolving');
      }
      $('battle-opponent').textContent = 'Opponent';
      updateBattleUI(data.state);
      $('moves-panel').classList.toggle('hidden', youAre === 'spectator');
      $('lobby-status').textContent = '';
      $('btn-find-battle').disabled = false;
    });

    socket.on('battleDisconnected', (msg) => {
      clearMoveCountdown();
      setMoveButtonsEnabled(false);
      $('battle-winner-msg').textContent = msg;
      $('battle-finished').classList.remove('hidden');
    });

    socket.on('requestMove', (state) => {
      battleState = state;
      if (state.moveTurnMs) moveTurnMs = state.moveTurnMs;
      const st = $('battle-status');
      if (st) {
        st.textContent = 'Choose a move.';
        st.classList.remove('turn-resolving');
      }
      updateBattleUI(state);
      setMoveButtonsEnabled(true);
      startMoveCountdown(state.moveTurnMs || moveTurnMs);
    });

    socket.on('moveStatus', (s) => {
      if (youAre === 'spectator') return;
      const myReady = youAre === 'p1' ? s.p1Ready : s.p2Ready;
      const oppReady = youAre === 'p1' ? s.p2Ready : s.p1Ready;
      const el = $('battle-status');
      if (!el) return;
      if (s.timedOut) {
        el.textContent = 'Time up — move 1 (slot 1) used.';
        return;
      }
      if (myReady && oppReady) {
        el.textContent = 'Both locked — resolving…';
      } else if (myReady) {
        el.textContent = 'Move locked — waiting for opponent…';
      } else {
        el.textContent = 'Choose a move.';
      }
    });

    socket.on('turnResolving', (data) => {
      const el = $('battle-status');
      if (el) {
        el.textContent = (data && data.message) || 'Turn processed.';
        el.classList.add('turn-resolving');
      }
    });

    socket.on('battleEvents', (events) => {
      const turnNum = battleState && battleState.turn;
      if (turnNum != null) {
        appendMatrixLine(`— Turn ${turnNum} —`, 'matrix-system');
      }
      events.forEach((e) => {
        if (e.type === 'move') {
          triggerBattleMotion(e.actor, e.target);
          appendMatrixLine(
            `${e.actor.toUpperCase()} → ${e.target.toUpperCase()} · ${e.move} · ${e.damage} DMG`,
            ''
          );
          if (e.crit) appendMatrixLine('A critical hit!', 'matrix-crit');
          const eff = e.effectiveness;
          if (eff !== undefined && eff !== 1) {
            const txt = effectivenessText(eff);
            if (txt) appendMatrixLine(txt, effectivenessClass(eff));
          }
        } else if (e.type === 'miss') {
          appendMatrixLine(`${e.actor}'s ${e.move} missed!`, 'matrix-miss');
        } else if (e.type === 'faint') {
          appendMatrixLine(`${e.pokemon} fainted!`, 'matrix-faint');
        } else if (e.type === 'autoSwitch') {
          appendMatrixLine(`${e.player} sent out ${e.to}.`, 'matrix-system');
        } else if (e.type === 'residual' && e.damage) {
          appendMatrixLine(`${e.pokemon} took ${e.damage} residual damage.`, '');
        }
      });
    });

    socket.on('battleState', (state) => {
      battleState = state;
      updateBattleUI(state);
    });

    socket.on('battleFinished', (winner) => {
      clearMoveCountdown();
      setMoveButtonsEnabled(false);
      $('battle-winner-msg').textContent = winner === username ? 'You win!' : 'You lose!';
      $('battle-finished').classList.remove('hidden');
      const st = $('battle-status');
      if (st) {
        st.textContent = 'Battle ended.';
        st.classList.remove('turn-resolving');
      }
    });

    socket.on('battleList', (battles) => {
      renderBattleList(battles);
    });

    socket.on('spectateStart', (data) => {
      youAre = 'spectator';
      battleState = data.state;
      setScreen('battle');
      $('battle-finished').classList.add('hidden');
      const mx = $('battle-matrix-log');
      if (mx) mx.innerHTML = '';
      $('battle-opponent').textContent = 'Spectating';
      $('moves-panel').classList.add('hidden');
      updateBattleUI(data.state);
    });

    socket.on('spectateEnd', (data) => {
      youAre = 'p1';
      setScreen('lobby');
      showLobbyMain();
      $('lobby-status').textContent = `Winner: ${data.winner}`;
      setTimeout(() => {
        $('lobby-status').textContent = '';
      }, 4000);
    });

    socket.on('error', (msg) => {
      $('lobby-status').textContent = msg;
      $('btn-find-battle').disabled = false;
      if (inQueue) {
        showMatchmakingStatus(false);
        stopQueueTimer();
        inQueue = false;
        queueStartTime = null;
      }
    });
  }

  function updateLobbyStatus(status) {
    $('online-count').textContent = status.onlinePlayers || 0;
    $('queue-count').textContent = status.playersInQueue || 0;
    $('battle-count').textContent = status.activeBattles || 0;
    $('wait-time').textContent = status.averageWaitTime || 0;
    if (socket) socket.emit('getQueueList');
  }

  function showMatchmakingStatus(show) {
    const mm = $('matchmaking-status');
    if (mm) mm.classList.toggle('hidden', !show);
    $('btn-find-battle').disabled = !!show;
  }

  function startQueueTimer() {
    stopQueueTimer();
    queueTimer = setInterval(() => {
      if (queueStartTime) {
        const elapsed = Math.floor((Date.now() - queueStartTime) / 1000);
        const el = $('queue-timer');
        if (el) el.textContent = `Wait time: ${elapsed}s`;
      }
    }, 1000);
  }

  function stopQueueTimer() {
    if (queueTimer) {
      clearInterval(queueTimer);
      queueTimer = null;
    }
  }

  function renderBattleList(battles) {
    const container = $('battles-container');
    if (!container) return;
    if (!battles || battles.length === 0) {
      container.innerHTML = '<p class="small">No active battles</p>';
      return;
    }

    container.innerHTML = '';
    battles.forEach((battle) => {
      const div = document.createElement('div');
      div.className = 'battle-item';
      div.innerHTML = `
        <div class="battle-item-header">
          <span>Battle #${battle.battleId.slice(-8)}</span>
          <span>${battle.spectators} 👁</span>
        </div>
        <div class="battle-item-players">${battle.player1} vs ${battle.player2}</div>
        <div class="battle-item-meta">
          <span>Turn ${battle.turn}</span>
          <span>${battle.duration}s</span>
        </div>
      `;
      div.addEventListener('click', () => {
        socket.emit('spectateBattle', { battleId: battle.battleId });
      });
      container.appendChild(div);
    });
  }

  function renderPresetButtons(presets) {
    const wrap = $('preset-buttons');
    if (!wrap) return;
    wrap.innerHTML = '';
    presets.forEach((p) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-btn';
      btn.textContent = p.name;
      btn.addEventListener('click', () => {
        applyTeamSpecies(p.species || []);
        $('team-msg').textContent = 'Preset loaded. Save to keep.';
      });
      wrap.appendChild(btn);
    });
  }

  function applyTeamSpecies(names) {
    currentTeam = (names || []).filter(Boolean).slice(0, 6);
    renderTeamRow();
    const dex = $('dex-search');
    renderDexGrid(dex ? dex.value : '');
  }

  function renderTeamRow() {
    const row = $('team-row');
    if (!row) return;
    row.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const name = currentTeam[i];
      const div = document.createElement('div');
      div.className = 'team-slot-pick' + (name ? '' : ' empty');
      if (name) {
        const spec = speciesList.find((s) => s.name === name);
        const id = spec ? spec.id : null;
        const img = document.createElement('img');
        img.alt = '';
        img.src = id ? spriteUrl(id) : '';
        const cap = document.createElement('span');
        cap.className = 'slot-name';
        cap.textContent = name;
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'slot-remove';
        rm.setAttribute('aria-label', 'Remove');
        rm.textContent = '×';
        rm.addEventListener('click', (e) => {
          e.stopPropagation();
          currentTeam.splice(i, 1);
          renderTeamRow();
          const dex = $('dex-search');
          renderDexGrid(dex ? dex.value : '');
        });
        div.appendChild(rm);
        div.appendChild(img);
        div.appendChild(cap);
      } else {
        const cap = document.createElement('span');
        cap.className = 'slot-name';
        cap.textContent = '—';
        div.appendChild(cap);
      }
      row.appendChild(div);
    }
  }

  function renderDexGrid(filterText) {
    const grid = $('dex-grid');
    if (!grid || !speciesList.length) return;
    const q = String(filterText || '').trim().toLowerCase();
    const list = q ? speciesList.filter((s) => s.name.toLowerCase().includes(q)) : speciesList;
    grid.innerHTML = '';
    list.forEach(({ name, id }) => {
      const inTeam = currentTeam.includes(name);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dex-cell' + (inTeam ? ' in-team' : '');
      const img = document.createElement('img');
      img.alt = '';
      img.src = spriteUrl(id);
      const lab = document.createElement('span');
      lab.textContent = name;
      btn.appendChild(img);
      btn.appendChild(lab);
      if (!inTeam) {
        btn.addEventListener('click', () => {
          if (currentTeam.length >= 6) {
            $('team-msg').textContent = 'Team is full (6). Remove one first.';
            return;
          }
          if (currentTeam.includes(name)) return;
          currentTeam.push(name);
          $('team-msg').textContent = '';
          renderTeamRow();
          const dex = $('dex-search');
          renderDexGrid(dex ? dex.value : '');
        });
      }
      grid.appendChild(btn);
    });
  }

  $('btn-random-team').addEventListener('click', () => {
    if (!speciesList.length) return;
    const shuffled = [...speciesList].sort(() => 0.5 - Math.random());
    const picked = shuffled.slice(0, 6).map((s) => s.name);
    applyTeamSpecies(picked);
    $('team-msg').textContent = 'Random team loaded. Save to keep.';
  });

  $('dex-search').addEventListener('input', (e) => {
    renderDexGrid(e.target.value);
  });

  $('btn-clear-team').addEventListener('click', () => {
    currentTeam = [];
    renderTeamRow();
    const dex = $('dex-search');
    renderDexGrid(dex ? dex.value : '');
    $('team-msg').textContent = 'Team cleared.';
  });

  $('btn-save-team').addEventListener('click', async () => {
    const speciesNames = currentTeam.slice();
    if (speciesNames.length < 3) {
      $('team-msg').textContent = 'Pick at least 3 Pokémon.';
      return;
    }
    $('team-msg').textContent = 'Saving...';
    try {
      const teamName = ($('team-name-input') && $('team-name-input').value.trim()) || 'My team';
      const res = await fetch(API + '/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, speciesNames, teamName })
      });
      const data = await res.json();
      if (data.ok) {
        $('team-msg').textContent = 'Team saved.';
      } else {
        $('team-msg').textContent = data.error || 'Save failed';
      }
    } catch (err) {
      $('team-msg').textContent = 'Network error';
    }
  });

  $('btn-edit-team').addEventListener('click', async () => {
    if (!speciesList.length) {
      await loadLobbyData(!password);
    }
    setScreen('team');
  });

  $('btn-back-lobby-from-team').addEventListener('click', () => {
    setScreen('lobby');
  });

  $('btn-find-battle').addEventListener('click', () => {
    if (inQueue) {
      if (!socket) initSocket();
      const leave = () => socket.emit('leaveBattle');
      if (socket.connected) leave();
      else socket.once('connect', leave);
      return;
    }

    const payload =
      currentTeam.length >= 3 && currentTeam.length <= 6 ? { speciesNames: currentTeam.slice() } : {};

    whenAuthenticated(() => {
      socket.emit('joinBattle', payload);
    });
  });

  $('btn-cancel-queue').addEventListener('click', () => {
    if (socket && inQueue) socket.emit('leaveBattle');
  });

  $('btn-spectate').addEventListener('click', () => {
    setScreen('lobby');
    showLobbySpectator();
    if (socket) {
      socket.emit('spectateBattle', {});
    } else {
      initSocket();
    }
  });

  $('btn-back-lobby-spectator').addEventListener('click', () => {
    showLobbyMain();
  });

  $('btn-back-lobby').addEventListener('click', () => {
    clearMoveCountdown();
    setScreen('lobby');
    loadLobbyData(!password);
  });

  function updateBattleUI(state) {
    const mp = $('moves-panel');
    if (mp) mp.classList.toggle('hidden', youAre === 'spectator');
    const p1 = state.p1Active;
    const p2 = state.p2Active;
    const p1HP = state.p1HP ?? 0;
    const p1Max = state.p1MaxHP ?? 1;
    const p2HP = state.p2HP ?? 0;
    const p2Max = state.p2MaxHP ?? 1;
    const p1Id = state.p1ActiveId ?? getSpeciesId(state.p1Active);
    const p2Id = state.p2ActiveId ?? getSpeciesId(state.p2Active);
    if (youAre === 'p1') {
      $('name-player').textContent = p1 || '—';
      $('name-enemy').textContent = p2 || '—';
      $('hp-bar-player').style.width = (p1Max ? (100 * p1HP / p1Max) : 0) + '%';
      $('hp-bar-enemy').style.width = (p2Max ? (100 * p2HP / p2Max) : 0) + '%';
      $('hp-text-player').textContent = `${p1HP}/${p1Max}`;
      $('hp-text-enemy').textContent = `${p2HP}/${p2Max}`;
      $('sprite-player').src = p1Id ? spriteUrl(p1Id) : '';
      $('sprite-enemy').src = p2Id ? spriteUrl(p2Id) : '';
    } else {
      $('name-player').textContent = p2 || '—';
      $('name-enemy').textContent = p1 || '—';
      $('hp-bar-player').style.width = (p2Max ? (100 * p2HP / p2Max) : 0) + '%';
      $('hp-bar-enemy').style.width = (p1Max ? (100 * p1HP / p1Max) : 0) + '%';
      $('hp-text-player').textContent = `${p2HP}/${p2Max}`;
      $('hp-text-enemy').textContent = `${p1HP}/${p1Max}`;
      $('sprite-player').src = p2Id ? spriteUrl(p2Id) : '';
      $('sprite-enemy').src = p1Id ? spriteUrl(p1Id) : '';
    }
    $('hp-bar-player').classList.toggle('low', (p1Max && p2Max) && (youAre === 'p1' ? p1HP / p1Max : p2HP / p2Max) < 0.25);
    $('hp-bar-enemy').classList.toggle('low', (p1Max && p2Max) && (youAre === 'p1' ? p2HP / p2Max : p1HP / p1Max) < 0.25);
    const moves = youAre === 'p1' ? (state.p1Moves || []) : (state.p2Moves || []);
    moves.forEach((m, i) => {
      const btn = document.querySelector(`.move-btn[data-index="${i}"]`);
      if (btn) {
        btn.textContent = m.name + (m.currentPP !== undefined ? ` (${m.currentPP}/${m.maxPP})` : '');
        btn.disabled = !m.currentPP;
      }
    });
  }

  function getSpeciesId(name) {
    const s = speciesList.find((x) => (x.name || '').toLowerCase() === (name || '').toLowerCase());
    return s ? s.id : null;
  }

  function setMoveButtonsEnabled(enabled) {
    document.querySelectorAll('.move-btn').forEach((btn) => {
      if (youAre === 'spectator') {
        btn.disabled = true;
        return;
      }
      btn.disabled =
        !enabled ||
        (battleState &&
          (youAre === 'p1' ? battleState.p1Moves : battleState.p2Moves)?.[parseInt(btn.dataset.index, 10)]?.currentPP === 0);
    });
  }

  document.querySelectorAll('.move-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!socket || !battleState || youAre === 'spectator') return;
      const index = parseInt(btn.dataset.index, 10);
      socket.emit('chooseMove', { moveIndex: index });
      setMoveButtonsEnabled(false);
    });
  });
})();
