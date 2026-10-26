import {apiBase} from './config.js';
import {ApiClient} from './api.js';
import {SessionStore, ReviewState, errorMessage, configurationState, openNextSession} from './state.js';
import {GeneratorCheck} from './generator.js';
import {differences, approve, equal} from '../src/comparison.js';

const element = id => document.getElementById(id);
const review = new ReviewState();
const generator = new GeneratorCheck(element('generator'));
let store;
let api;
let campaign;
let campaignExpired = false;
let busy = false;
let expiryTimer;
let imageUrl;

function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) {
    result.textContent = text;
  }
  if (className) {
    result.className = className;
  }
  return result;
}

function message(text, error = false) {
  element('message').textContent = text;
  element('message').classList.toggle('error', error);
}

function button(text, action, disabled = false) {
  const result = node('button', text);
  result.type = 'button';
  result.disabled = disabled;
  result.addEventListener('click', () => perform(action));
  return result;
}

function clearReview() {
  review.clear();
  element('review').hidden = true;
  element('changes').replaceChildren();
  element('review-actions').replaceChildren();
}

function hideInvitation() {
  element('invite-link').value = '';
  element('invitation').hidden = true;
}

function clearProfile() {
  element('profile').hidden = true;
  element('profile-story').textContent = '';
  element('profile-image').removeAttribute('src');
  if (imageUrl) {
    URL.revokeObjectURL(imageUrl);
    imageUrl = null;
  }
}

function leave() {
  clearTimeout(expiryTimer);
  store.clear();
  campaign = null;
  clearReview();
  clearProfile();
  hideInvitation();
  element('players').replaceChildren();
  element('dashboard').hidden = true;
  element('access').hidden = false;
  element('delete-name').value = '';
}

function armExpiry() {
  clearTimeout(expiryTimer);
  const session = store.read();
  if (!session) {
    leave();
    return;
  }
  expiryTimer = setTimeout(() => {
    leave();
    message('La sesión ha caducado. Entra de nuevo.', true);
  }, session.expiresAt - Date.now());
}

async function perform(action) {
  if (busy) {
    return;
  }
  busy = true;
  document.body.setAttribute('aria-busy', 'true');
  const controls = [...document.querySelectorAll('button, input')];
  const disabled = controls.map(control => control.disabled);
  controls.forEach(control => { control.disabled = true; });
  try {
    await action();
  } catch (error) {
    if ([412, 503, 0].includes(error.status)) {
      clearReview();
      clearProfile();
      // No se reutiliza ninguna revisión tras una respuesta incierta.
      campaign = null;
      element('session-action').disabled = true;
      element('visibility').disabled = true;
      element('players').replaceChildren();
    }
    if (error.status === 401) {
      leave();
    }
    message(errorMessage(error), true);
    element('message').scrollIntoView({block: 'nearest'});
  } finally {
    controls.forEach((control, index) => {
      if (control.isConnected) {
        control.disabled = disabled[index];
      }
    });
    element('session-action').disabled = !campaign || campaignExpired;
    element('visibility').disabled = !campaign || campaignExpired;
    busy = false;
    document.body.removeAttribute('aria-busy');
  }
}

function campaignPath() {
  const session = store.read();
  if (!session) {
    throw Object.assign(Error('La sesión ha caducado. Entra de nuevo.'), {status: 401});
  }
  return `/campaigns/${encodeURIComponent(session.campaignId)}`;
}

function playerPath(player) {
  return `${campaignPath()}/players/${encodeURIComponent(player.id)}`;
}

async function reload() {
  clearReview();
  clearProfile();
  const result = await api.request(campaignPath());
  campaign = result.campaign;
  campaignExpired = result.expired;
  element('access').hidden = true;
  element('dashboard').hidden = false;
  element('campaign-title').textContent = campaign.name;
  element('campaign-state').textContent = `Sesión ${campaign.session_number} · ${campaign.state === 'open' ? 'Abierta' : 'Cerrada'}${result.expired ? ' · Campaña caducada: solo descarga o borrado' : ''}`;
  element('session-action').textContent = campaign.state === 'open' ? 'Cerrar sesión de juego' : 'Abrir siguiente sesión';
  element('session-action').disabled = result.expired;
  element('visibility').textContent = campaign.share_profiles ? 'Ocultar perfiles a jugadores' : 'Compartir perfiles con jugadores';
  element('visibility').disabled = result.expired;
  renderPlayers(result.players, result.expired);
  armExpiry();
  return campaign;
}

function supervisedAction(container, player) {
  const details = node('details');
  details.append(node('summary', 'Restablecer PIN'));
  const confirmation = node('div', undefined, 'confirm');
  confirmation.append(node('p', 'Verifica con la persona en la mesa que es dueña de este alias. Se invalidarán su PIN y sus sesiones. Después elegirá un PIN nuevo; confirma el candidato solo con esa persona presente.'));
  const label = node('label');
  const check = document.createElement('input');
  check.type = 'checkbox';
  label.append(check, node('span', 'He verificado la identidad del jugador'));
  const reset = button('Iniciar restablecimiento', async () => {
    if (!check.checked) {
      throw Error('Confirma primero la identidad del jugador.');
    }
    await api.request(`${playerPath(player)}/pin-reset`, {method: 'POST', revision: player.credential_version});
    await reload();
    message('Restablecimiento iniciado. El jugador debe proponer su nuevo PIN.');
  }, true);
  check.addEventListener('change', () => { reset.disabled = !check.checked; });
  confirmation.append(label, reset);
  if (player.has_pending_pin) {
    const actions = node('div', undefined, 'actions wrap');
    for (const [decision, title] of [['accept', 'Confirmar candidato de PIN'], ['reject', 'Rechazar candidato de PIN']]) {
      actions.append(button(title, async () => {
        if (!check.checked) {
          throw Error('Confirma primero la identidad del jugador que ha propuesto el PIN.');
        }
        await api.request(`${playerPath(player)}/pin-reset/confirm`, {
          method: 'POST',
          revision: player.credential_version,
          body: {decision}
        });
        await reload();
        message(decision === 'accept' ? 'Candidato confirmado. El jugador ya puede entrar con su nuevo PIN.' : 'Candidato rechazado. El jugador puede proponer otro PIN.');
      }));
    }
    confirmation.append(actions);
  }
  details.append(confirmation);
  container.append(details);
}

function renderPlayers(players, expired) {
  element('players').replaceChildren();
  if (!players.length) {
    element('players').append(node('p', 'Todavía no hay jugadores. Comparte el enlace de invitación que guardaste.'));
  }
  const states = {pending: 'Entrada pendiente', approved: 'Admitido', rejected: 'Entrada rechazada'};
  for (const player of players) {
    const card = node('article', undefined, 'player');
    card.append(node('h3', player.alias));
    card.append(node('p', `${states[player.status] ?? player.status} · Ficha oficial ${player.official_revision}${player.reset_required ? ' · PIN pendiente de restablecer' : ''}`));
    const actions = node('div', undefined, 'actions wrap');
    if (!expired) {
      actions.append(button('Revisar ficha', () => openReview(player)));
      actions.append(button('Ver perfil', () => openProfile(player)));
      supervisedAction(card, player);
    }
    if (player.official_revision) {
      actions.append(button('Descargar oficial', () => downloadOfficial(player)));
    }
    card.append(actions);
    element('players').append(card);
  }
}

async function openReview(player) {
  clearReview();
  message('Descargando la oficial y la propuesta…');
  const data = await api.request(`${playerPath(player)}/review`);
  let groups = [];
  if (data.pending) {
    message('Comprobando la ficha con el generador v4…');
    await generator.check(data.pending);
    if (data.official) {
      await generator.check(data.official);
      groups = differences(data.official, data.pending, generator.labels);
      const localIds = groups.map(group => group.id).sort();
      const remoteIds = data.differences.map(group => group.id).sort();
      if (!equal(localIds, remoteIds)) {
        throw Error('El comparador local y el servidor no coinciden. No se puede aprobar.');
      }
    }
  }
  campaignPath();
  review.load(player, data, groups);
  renderReview();
  element('review').scrollIntoView({block: 'start'});
  message(data.pending ? 'Ficha comprobada. Revisa antes de aprobar.' : 'No hay ficha pendiente para este jugador.');
}

const valueText = value => value === undefined ? '(ausente)' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);

function renderReview() {
  element('review').hidden = false;
  element('review-title').textContent = `Revisar ficha · ${review.player.alias}`;
  element('changes').replaceChildren();
  element('review-actions').replaceChildren();
  const data = review.data;
  if (!data.pending) {
    element('review-summary').textContent = 'Sin ficha pendiente. Puedes descargar la oficial desde la lista de jugadores.';
    return;
  }
  if (!data.official) {
    element('review-summary').textContent = `Entrada de ${data.pending.form.personaje}. La ficha v4 se ha cargado y exportado sin pérdida de datos.`;
    const fields = node('details');
    fields.append(node('summary', 'Ver ficha de entrada completa'));
    fields.append(node('pre', JSON.stringify(data.pending, null, 2), 'values'));
    element('changes').append(fields);
    element('review-actions').append(button('Admitir entrada', () => admission('accept')));
    element('review-actions').append(button('Rechazar entrada', () => admission('reject')));
    return;
  }
  const count = Object.keys(review.decisions).length;
  element('review-summary').textContent = `${data.pending.form.personaje} · ${count} de ${review.groups.length} cambios revisados`;
  for (const group of review.groups) {
    const row = node('article', undefined, 'change');
    const content = node('div');
    content.append(node('h3', group.label));
    content.append(node('div', `${valueText(group.before)} → ${valueText(group.after)}`, 'values'));
    if (group.changes.length > 1) {
      const details = node('details');
      details.append(node('summary', 'Campos vinculados'));
      for (const change of group.changes) {
        details.append(node('div', `${change.path.join(' · ')}: ${valueText(change.before)} → ${valueText(change.after)}`));
      }
      content.append(details);
    }
    const actions = node('div', undefined, 'actions');
    actions.setAttribute('role', 'group');
    actions.setAttribute('aria-label', group.label);
    for (const [decision, title] of [['accept', 'Aceptar'], ['reject', 'Rechazar']]) {
      const choose = button(title, () => {
        review.decide(group.id, decision);
        renderReview();
        const replacement = [...element('changes').children][review.groups.indexOf(group)];
        replacement.querySelectorAll('button')[decision === 'accept' ? 0 : 1].focus();
        message('Decisión guardada en esta revisión.');
      });
      choose.setAttribute('aria-pressed', String(review.decisions[group.id] === decision));
      actions.append(choose);
    }
    row.append(content, actions);
    element('changes').append(row);
  }
  element('review-actions').append(button('Aprobar resolución', resolution, !review.complete()));
}

async function admission(decision) {
  const player = review.player;
  const data = review.data;
  if (decision === 'accept') {
    message('Comprobando de nuevo la ficha antes de admitir…');
    await generator.check(data.pending);
  }
  await api.request(`${playerPath(player)}/admission`, {
    method: 'POST',
    revision: data.sheetRevision,
    body: {decision}
  });
  await reload();
  message(decision === 'accept' ? 'Entrada admitida. La ficha ya es oficial.' : 'Entrada rechazada.');
}

async function resolution() {
  if (!review.complete()) {
    throw Error('Acepta o rechaza todos los cambios antes de aprobar.');
  }
  const player = review.player;
  const data = review.data;
  const generation = review.generation;
  const decisions = review.groups.map(group => ({id: group.id, decision: review.decisions[group.id]}));
  const approved = approve(data.official, review.groups, review.decisions);
  message('Comprobando la resolución con el generador v4…');
  await generator.check(approved);
  if (generation !== review.generation) {
    throw Error('La revisión ha cambiado. Revisa las decisiones antes de aprobar.');
  }
  await api.request(`${playerPath(player)}/approval`, {
    method: 'POST',
    revision: data.sheetRevision,
    body: {sessionNumber: data.sessionNumber, decisions}
  });
  await reload();
  message('Resolución aprobada. La ficha oficial está disponible para descargar.');
}

async function downloadOfficial(player) {
  const blob = await api.request(`${playerPath(player)}/official`, {blob: true});
  const data = JSON.parse(await blob.text());
  await generator.check(data);
  campaignPath();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'Ficha_aprobada.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  message('Descarga iniciada. La ficha ha superado la comprobación del generador v4.');
}

async function openProfile(player) {
  clearProfile();
  const profile = await api.request(`${playerPath(player)}/profile`);
  let blob;
  if (profile.has_image) {
    blob = await api.request(`${playerPath(player)}/image`, {blob: true});
  }
  element('profile-title').textContent = `Perfil · ${player.alias}`;
  element('profile-story').textContent = profile.story || 'Sin historia.';
  element('profile-actions').replaceChildren();
  element('profile-image').hidden = !blob;
  if (blob) {
    imageUrl = URL.createObjectURL(blob);
    element('profile-image').src = imageUrl;
    element('profile-actions').append(button('Retirar imagen', async () => {
      await api.request(`${playerPath(player)}/image`, {method: 'DELETE', revision: profile.profile_revision});
      clearProfile();
      message('Imagen retirada. El jugador puede subir otra.');
    }));
  }
  element('profile').hidden = false;
  element('profile').scrollIntoView({block: 'start'});
  message('Perfil cargado.');
}

async function authenticate(path, body, admin) {
  hideInvitation();
  const response = await api.request(path, {method: 'POST', auth: false, admin, body});
  try {
    store.save(response);
  } catch {
    // Revoca el token emitido si el navegador no permite conservarlo con seguridad.
    const temporary = {read: () => response};
    await new ApiClient(apiBase, temporary).request('/auth/session', {method: 'DELETE'}).catch(() => {});
    throw Error('No se pudo guardar la sesión en sessionStorage. Permite el almacenamiento de sesión e inténtalo de nuevo.');
  }
  if (response.code) {
    const invitation = new URL('./', location.href);
    invitation.hash = `invite=${encodeURIComponent(response.code)}`;
    element('invite-link').value = invitation.href;
    element('invitation').hidden = false;
    delete response.code;
  }
  await reload();
  message('Sesión del narrador iniciada.');
}

function wire() {
  element('create-form').addEventListener('submit', event => {
    event.preventDefault();
    const admin = element('create-key').value;
    const name = element('campaign-name').value;
    element('create-key').value = '';
    perform(() => authenticate('/campaigns', {name}, admin));
  });
  element('login-form').addEventListener('submit', event => {
    event.preventDefault();
    const admin = element('login-key').value;
    const code = element('campaign-code').value.trim();
    element('login-key').value = '';
    element('campaign-code').value = '';
    perform(() => authenticate('/auth/narrator', {code}, admin));
  });
  element('copy-invite').addEventListener('click', () => perform(async () => {
    try {
      await navigator.clipboard.writeText(element('invite-link').value);
      message('Enlace copiado. Guárdalo en un lugar privado.');
    } catch {
      throw Error('No se pudo copiar. Selecciona y copia el enlace manualmente antes de ocultarlo.');
    }
  }));
  element('hide-invite').addEventListener('click', hideInvitation);
  element('reload').addEventListener('click', () => perform(async () => {
    await reload();
    message('Campaña recargada. Abre la ficha para comenzar una revisión nueva.');
  }));
  element('session-action').addEventListener('click', () => perform(async () => {
    if (!campaign) {
      throw Error('Recarga la campaña antes de continuar.');
    }
    const action = campaign.state === 'open' ? 'close' : 'open-next';
    const before = {...campaign};
    const request = () => api.request(`${campaignPath()}/${action}`, {
      method: 'POST',
      revision: before.revision,
      body: {sessionNumber: before.session_number}
    });
    if (action === 'open-next') {
      const result = await openNextSession(before, request, reload);
      if (!result.opened) {
        message(result.message, true);
        return;
      }
    } else {
      await request();
    }
    await reload();
    message(action === 'close' ? 'Sesión cerrada. Los jugadores pueden enviar sus propuestas.' : 'Siguiente sesión abierta.');
  }));
  element('visibility').addEventListener('click', () => perform(async () => {
    if (!campaign) {
      throw Error('Recarga la campaña antes de continuar.');
    }
    await api.request(`${campaignPath()}/settings`, {
      method: 'PATCH',
      revision: campaign.revision,
      body: {shareProfiles: !campaign.share_profiles}
    });
    await reload();
    message(campaign.share_profiles ? 'Los jugadores admitidos pueden ver los perfiles de la campaña.' : 'Perfiles ocultos a los demás jugadores. El narrador sigue teniendo acceso.');
  }));
  element('logout').addEventListener('click', () => perform(async () => {
    try {
      await api.request('/auth/session', {method: 'DELETE'});
      leave();
      message('Sesión cerrada y token borrado de este navegador.');
    } catch (error) {
      leave();
      throw Error(`Token borrado de este navegador. No se pudo confirmar su revocación en el servidor: ${errorMessage(error)}`);
    }
  }));
  element('delete-form').addEventListener('submit', event => {
    event.preventDefault();
    perform(async () => {
      if (!campaign || element('delete-name').value !== campaign.name) {
        throw Error('Escribe el nombre exacto de la campaña para confirmar el borrado.');
      }
      await api.request(campaignPath(), {method: 'DELETE', revision: campaign.revision});
      leave();
      message('Campaña borrada.');
    });
  });
}

try {
  const availability = configurationState(apiBase);
  message(availability.message);
  if (availability.enabled) {
    store = new SessionStore(sessionStorage);
    api = new ApiClient(apiBase, store);
    wire();
    element('access').hidden = false;
    if (store.read()) {
      perform(async () => {
        await reload();
        message('Sesión del narrador recuperada.');
      });
    }
  }
} catch (error) {
  message(error.message, true);
}
