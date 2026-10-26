import {SessionStore} from './state.js';
import {takeInvitation} from './player-state.js';

const mode = location.hash;
const invitation = takeInvitation(location, history);
let playerSession;
try {
  playerSession = new SessionStore(sessionStorage, Date.now, 'player').read();
} catch {
  playerSession = null;
}
window.addEventListener('hashchange', () => {
  if (['#narrator', '#player'].includes(location.hash) || location.hash.startsWith('#invite=')) {
    location.reload();
  }
});
if (invitation !== null || mode === '#player' || mode !== '#narrator' && playerSession) {
  const {startPlayer} = await import('./player.js');
  startPlayer(invitation);
} else {
  await import('./app.js');
}
