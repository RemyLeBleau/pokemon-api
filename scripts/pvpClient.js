#!/usr/bin/env node
/**
 * Minimal Socket.io PvP client. Connect, optionally set team, join battle, send move choices.
 * Usage: node scripts/pvpClient.js [username]
 * Example: node scripts/pvpClient.js bob
 */

const { io } = require('socket.io-client');
const SERVER = process.env.PVP_SERVER || 'http://localhost:3000';
const USERNAME = process.argv[2] || 'player1';

const socket = io(SERVER);

socket.on('connect', () => {
  console.log(`Connected as ${USERNAME}`);
  socket.emit('joinBattle', { username: USERNAME });
});

let youAre = 'p1';
socket.on('battleStart', ({ battleId, state, youAre: y }) => {
  youAre = y;
  console.log(`Battle started. You are ${youAre}. Turn ${state.turn}`);
});

socket.on('requestMove', (state) => {
  const moves = youAre === 'p1' ? state.p1Moves : state.p2Moves;
  const available = (moves || []).filter(m => m.currentPP > 0).map(m => m.index);
  const moveIndex = available.length > 0
    ? available[Math.floor(Math.random() * available.length)]
    : 0;
  socket.emit('chooseMove', { moveIndex });
});

socket.on('battleEvents', (events) => {
  for (const e of events) {
    if (e.type === 'move') console.log(`  ${e.actor} used ${e.move} on ${e.target} | ${e.hpBefore} -> ${e.hpAfter}`);
    if (e.type === 'miss') console.log(`  ${e.actor}'s ${e.move} missed`);
    if (e.type === 'faint') console.log(`  ${e.pokemon} fainted`);
    if (e.type === 'autoSwitch') console.log(`  ${e.player} switched to ${e.to}`);
  }
});

socket.on('battleState', () => {});
socket.on('battleFinished', (winner) => {
  console.log(`Battle finished. Winner: ${winner}`);
  socket.disconnect();
});

socket.on('error', (msg) => console.error('Error:', msg));
