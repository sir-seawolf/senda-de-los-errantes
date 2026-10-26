import {apiBase} from './config.js';
import {ApiClient} from './api.js';
import {SessionStore} from './state.js';
import {byteLength, validatePin, weakPin, generatePin, checkSheet, sheetPermissions, resolutionNotice, playerError} from './player-state.js';
import {reduceImage} from './image.js';

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) {
    element.textContent = text;
  }
  if (className) {
    element.className = className;
  }
  return element;
}

export function startPlayer(invitation) {
  const main = document.querySelector('main');
  main.replaceChildren();
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = new URL('./player.css', import.meta.url).href;
  document.head.append(style);
  document.title = 'Campaña · Jugador · La Senda de los Errantes';
  const header = node('header');
  const back = node('a', '← Comparar archivos');
  back.href = '../';
  header.append(back, node('p', 'PARTIDA DE ROL · JUGADOR', 'eyebrow'), node('h1', 'Tu personaje en la mesa'), node('p', 'Entrega tu ficha y guarda tu historia. El narrador decide los cambios oficiales.'));
  const status = node('p', 'Servicio de campañas no configurado');
  status.id = 'message';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  main.append(header, status);
  let code = invitation;
  let store;
  let api;
  let config;
  let campaign;
  let me;
  let review;
  let profile;
  let selectedSheet;
  let selectedImage;
  let busy = false;
  let expiryTimer;
  let waitTimer;
  const urls = new Map();
  const controls = {};
  const progressKey = 'senda.player.proposal';

  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle('error', error);
  }

  function panel(title, parent = main) {
    const section = node('section', undefined, 'panel');
    section.append(node('h2', title));
    parent.append(section);
    return section;
  }

  function button(text, action, parent) {
    const result = node('button', text);
    result.type = 'button';
    result.addEventListener('click', () => run(action));
    parent.append(result);
    return result;
  }

  function field(labelText, id, parent, type = 'text') {
    const label = node('label', labelText);
    label.htmlFor = id;
    const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    input.id = id;
    if (type !== 'textarea') {
      input.type = type;
    }
    input.autocomplete = 'off';
    parent.append(label, input);
    return input;
  }

  function setImage(image, blob, slot) {
    if (urls.has(slot)) {
      URL.revokeObjectURL(urls.get(slot));
      urls.delete(slot);
    }
    image.removeAttribute('src');
    image.hidden = !blob;
    if (blob) {
      const url = URL.createObjectURL(blob);
      urls.set(slot, url);
      image.src = url;
    }
  }

  function clearSheet() {
    selectedSheet = null;
    if (controls.file) {
      controls.file.value = '';
      controls.fileInfo.textContent = 'Sin ficha preparada.';
    }
  }

  function clearImage() {
    selectedImage = null;
    if (controls.imageFile) {
      controls.imageFile.value = '';
      setImage(controls.preview, null, 'preview');
    }
  }

  function leave() {
    clearTimeout(expiryTimer);
    store.clear();
    sessionStorage.removeItem(progressKey);
    campaign = null;
    me = null;
    review = null;
    profile = null;
    clearSheet();
    clearImage();
    for (const url of urls.values()) {
      URL.revokeObjectURL(url);
    }
    urls.clear();
    controls.dashboard.hidden = true;
    controls.access.hidden = false;
    controls.peers.replaceChildren();
    controls.story.value = '';
    controls.pin.value = '';
  }

  function activeSession() {
    const session = store.read();
    if (!session) {
      throw Object.assign(Error('Sesión caducada.'), {status: 401});
    }
    return session;
  }

  function path(playerId = activeSession().playerId) {
    const session = activeSession();
    return `/campaigns/${encodeURIComponent(session.campaignId)}/players/${encodeURIComponent(playerId)}`;
  }

  function permissions() {
    const sheet = campaign && me ? sheetPermissions(campaign, me) : {};
    controls.send.disabled = busy || !selectedSheet || !(sheet.entry || sheet.proposal);
    controls.saveStory.disabled = busy || !profile || byteLength(controls.story.value) > 8000;
    controls.uploadImage.disabled = busy || !profile || !selectedImage;
    controls.deleteImage.disabled = busy || !profile?.has_image;
  }

  async function connect() {
    config = await api.request('/config', {auth: false});
    controls.pinHint.textContent = `${config.pinLength} caracteres. Alfabeto permitido: ${config.pinAlphabet}. No distingue mayúsculas.`;
    controls.pin.maxLength = config.pinLength;
    controls.access.hidden = false;
    if (store.read()) {
      await refresh();
      message('Sesión del jugador recuperada.');
    } else {
      message(code ? 'Entra o crea tu jugador. Guarda el enlace original y tu PIN.' : 'Abre tu enlace de invitación guardado para entrar.');
    }
  }

  async function run(action) {
    if (busy) {
      return;
    }
    busy = true;
    const elements = [...main.querySelectorAll('button,input,textarea')];
    const disabled = elements.map(element => element.disabled);
    elements.forEach(element => { element.disabled = true; });
    main.setAttribute('aria-busy', 'true');
    try {
      await action();
    } catch (error) {
      if (error.status === 401) {
        leave();
      }
      if ([409, 412, 503, 0, 410, 403].includes(error.status)) {
        clearSheet();
        clearImage();
        profile = null;
        campaign = null;
        controls.peers.replaceChildren();
      }
      message(playerError(error), true);
      if (error.status === 429) {
        clearInterval(waitTimer);
        const until = Date.now() + Math.max(1, error.retryAfter || 60) * 1000;
        waitTimer = setInterval(() => {
          const seconds = Math.ceil((until - Date.now()) / 1000);
          message(seconds > 0 ? `Demasiados intentos (429). Espera ${seconds} segundos.` : 'Ya puedes volver a intentarlo.');
          if (seconds <= 0) {
            clearInterval(waitTimer);
          }
        }, 1000);
      }
    } finally {
      elements.forEach((element, index) => {
        if (element.isConnected) {
          element.disabled = disabled[index];
        }
      });
      busy = false;
      main.removeAttribute('aria-busy');
      permissions();
    }
  }

  function rememberProposal(data) {
    if (data.pending && data.official) {
      const session = activeSession();
      sessionStorage.setItem(progressKey, JSON.stringify({
        campaignId: session.campaignId,
        playerId: session.playerId,
        officialRevision: data.officialRevision,
        pending: true
      }));
    }
  }

  async function refresh() {
    const session = activeSession();
    const state = await api.request(`/campaigns/${encodeURIComponent(session.campaignId)}`);
    const nextReview = await api.request(`${path()}/review`);
    const nextProfile = await api.request(`${path()}/profile`);
    let ownImage;
    if (nextProfile.has_image) {
      ownImage = await api.request(`${path()}/image`, {blob: true});
    }
    activeSession();
    let previous;
    try {
      previous = JSON.parse(sessionStorage.getItem(progressKey));
      if (previous?.campaignId !== session.campaignId || previous?.playerId !== session.playerId) {
        previous = null;
      }
    } catch {
      previous = null;
    }
    const notice = resolutionNotice(previous, nextReview);
    if (previous?.pending && !nextReview.pending) {
      sessionStorage.removeItem(progressKey);
    }
    if (selectedSheet && selectedSheet.revision !== state.me.sheet_revision) {
      clearSheet();
    }
    campaign = state.campaign;
    me = state.me;
    review = nextReview;
    profile = nextProfile;
    rememberProposal(review);
    controls.access.hidden = true;
    controls.dashboard.hidden = false;
    controls.title.textContent = campaign.name;
    controls.session.textContent = `Sesión ${campaign.session_number} · ${campaign.state === 'open' ? 'Abierta' : 'Cerrada'}`;
    controls.admission.textContent = me.status === 'pending' ? 'Pendiente de aprobación' : me.status === 'approved' ? 'Personaje admitido' : 'Entrada rechazada. Consulta al narrador.';
    controls.proposal.textContent = notice || (review.pending && !review.official ? 'Ficha de entrada enviada. El narrador debe admitirla.' : 'Sin propuesta pendiente.');
    controls.send.textContent = me.status === 'pending' ? 'Enviar ficha de entrada' : 'Enviar ficha modificada';
    controls.fileHint.textContent = me.status === 'approved' && campaign.state === 'open' ? 'Puedes elegir y comprobar un archivo. El envío se habilita al cerrar la sesión de juego.' : 'Máximo 256.000 bytes UTF-8. Puedes reemplazar una ficha pendiente.';
    controls.downloads.replaceChildren();
    if (me.status === 'approved') {
      for (let version = 0; version <= Math.min(2, me.official_revision - 1); version++) {
        button(version === 0 ? 'Descargar ficha oficial' : `Descargar anterior ${version}`, () => download(version), controls.downloads);
      }
    }
    controls.story.value = profile.story;
    updateStoryCount();
    clearImage();
    setImage(controls.currentImage, ownImage, 'own');
    controls.peers.replaceChildren();
    for (const slot of [...urls.keys()].filter(key => key.startsWith('peer:'))) {
      URL.revokeObjectURL(urls.get(slot));
      urls.delete(slot);
    }
    if (campaign.share_profiles && me.status === 'approved') {
      for (const peer of state.players.filter(player => player.id !== me.id)) {
        button(`Ver perfil de ${peer.alias}`, () => showPeer(peer), controls.peers);
      }
    } else {
      controls.peers.append(node('p', 'Los perfiles de otros jugadores no están compartidos.'));
    }
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => {
      leave();
      message('La sesión ha caducado. Vuelve a entrar con tu enlace guardado.', true);
    }, session.expiresAt - Date.now());
    permissions();
    return notice;
  }

  async function download(version) {
    const blob = await api.request(`${path()}/official?version=${version}`, {blob: true});
    checkSheet(await blob.text());
    activeSession();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = version === 0 ? 'Ficha_aprobada.json' : `Ficha_anterior_${version}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message('Descarga iniciada. Usa «Cargar JSON» en el generador v4.');
  }

  async function showPeer(peer) {
    const data = await api.request(`${path(peer.id)}/profile`);
    let blob;
    if (data.has_image) {
      blob = await api.request(`${path(peer.id)}/image`, {blob: true});
    }
    activeSession();
    const card = node('article', undefined, 'player');
    card.append(node('h3', data.alias), node('p', data.story || 'Sin historia.', 'player-story'));
    const image = node('img');
    image.alt = 'Imagen del personaje';
    setImage(image, blob, `peer:${peer.id}`);
    card.append(image);
    controls.peers.querySelector(`[data-player-id="${peer.id}"]`)?.remove();
    card.dataset.playerId = peer.id;
    controls.peers.append(card);
    message('Perfil cargado.');
  }

  function updateStoryCount() {
    const size = byteLength(controls.story.value);
    controls.storyCount.textContent = `${size} / 8.000 bytes UTF-8`;
    controls.storyCount.classList.toggle('error', size > 8000);
    permissions();
  }

  function pinHint() {
    controls.pinWarning.textContent = weakPin(controls.pin.value) ? 'Este PIN es fácil de adivinar. Te recomendamos generar otro; puedes conservarlo si pertenece al alfabeto permitido.' : '';
  }

  async function authenticate(kind) {
    const entered = controls.pin.value;
    controls.pin.value = '';
    pinHint();
    if (!code) {
      throw Error('Abre de nuevo el enlace de invitación que guardaste. El código no se conserva al recargar.');
    }
    const pin = validatePin(entered, config);
    const alias = controls.alias.value.trim();
    if (!alias) {
      throw Error('Escribe tu alias.');
    }
    const route = kind === 'join' ? '/join' : kind === 'reset' ? '/pin-reset/request' : '/auth/player';
    const response = await api.request(route, {method: 'POST', auth: false, body: {code, alias, pin}});
    if (kind === 'reset') {
      message('Nuevo PIN propuesto. El narrador debe confirmar este candidato contigo en la mesa. Después vuelve a entrar.');
      return;
    }
    try {
      store.save(response);
    } catch {
      const temporary = {read: () => response};
      await new ApiClient(apiBase, temporary).request('/auth/session', {method: 'DELETE'}).catch(() => {});
      throw Error('No se pudo guardar la sesión. Permite sessionStorage e inténtalo de nuevo.');
    }
    await refresh();
    message(kind === 'join' ? 'Pendiente de aprobación. Sube tu ficha de entrada para que el narrador pueda revisarla.' : 'Has entrado en la campaña.');
  }

  function build() {
    controls.retry = button('Reintentar conexión', connect, main);
    controls.retry.hidden = !apiBase.trim();
    controls.access = panel('Entrar con tu invitación');
    controls.access.append(node('p', 'Guarda el enlace original. Al abrirlo, el código se retira de la barra de direcciones y solo permanece en memoria.'));
    controls.alias = field('Tu alias', 'player-alias', controls.access);
    controls.alias.maxLength = 32;
    controls.pin = field('Tu PIN personal', 'player-pin', controls.access, 'password');
    controls.pin.spellcheck = false;
    controls.pinHint = node('p', undefined, 'hint');
    controls.pinWarning = node('p', undefined, 'hint');
    controls.access.append(controls.pinHint, controls.pinWarning);
    controls.pin.addEventListener('input', pinHint);
    button('Generar PIN', () => {
      controls.pin.value = generatePin(config);
      controls.pin.type = 'text';
      pinHint();
      message('PIN generado. Guárdalo en privado antes de continuar; no lo conservamos en el navegador.');
    }, controls.access);
    button('Mostrar u ocultar PIN', () => {
      controls.pin.type = controls.pin.type === 'password' ? 'text' : 'password';
    }, controls.access);
    button('Crear mi jugador', () => authenticate('join'), controls.access);
    button('Entrar con mi alias', () => authenticate('login'), controls.access);
    const reset = node('details');
    reset.append(node('summary', 'He olvidado mi PIN'), node('p', 'Pide al narrador que inicie el restablecimiento. Escribe arriba tu alias y el nuevo PIN; quedará como candidato hasta que el narrador confirme tu identidad en la mesa.'));
    button('Proponer nuevo PIN', () => authenticate('reset'), reset);
    controls.access.append(reset);
    controls.dashboard = node('div');
    controls.dashboard.hidden = true;
    main.append(controls.dashboard);
    const info = panel('Mi campaña', controls.dashboard);
    controls.title = node('h3');
    controls.session = node('p', undefined, 'values');
    controls.admission = node('p');
    controls.proposal = node('p');
    info.append(controls.title, controls.session, controls.admission, controls.proposal);
    button('Actualizar estado', async () => {
      const notice = await refresh();
      message(notice || 'Estado actualizado.');
    }, info);
    button('Salir', async () => {
      try {
        await api.request('/auth/session', {method: 'DELETE'});
      } finally {
        leave();
      }
      message('Sesión cerrada y token borrado de este navegador.');
    }, info);
    controls.downloads = node('div', undefined, 'actions wrap');
    info.append(controls.downloads);
    const sheet = panel('Mi ficha v4', controls.dashboard);
    controls.fileHint = node('p', undefined, 'hint');
    sheet.append(controls.fileHint);
    controls.file = field('Elegir ficha JSON', 'player-sheet', sheet, 'file');
    controls.file.accept = '.json,application/json';
    controls.fileInfo = node('p', 'Sin ficha preparada.', 'values');
    sheet.append(controls.fileInfo);
    controls.file.addEventListener('change', () => run(async () => {
      selectedSheet = null;
      controls.fileInfo.textContent = 'Comprobando archivo…';
      const file = controls.file.files[0];
      if (!file) {
        clearSheet();
        return;
      }
      if (file.size > 256000) {
        throw Error('La ficha supera 256.000 bytes UTF-8.');
      }
      const raw = new TextDecoder('utf-8', {fatal: true}).decode(await file.arrayBuffer());
      const data = checkSheet(raw);
      selectedSheet = {raw, revision: me.sheet_revision};
      controls.fileInfo.textContent = `${data.form.personaje} · ${byteLength(raw)} bytes · JSON v4 válido`;
      message('Ficha comprobada. El envío requiere que el estado de la sesión lo permita.');
    }));
    controls.send = button('Enviar ficha de entrada', async () => {
      const permission = sheetPermissions(campaign, me);
      if (!selectedSheet || !(permission.entry || permission.proposal)) {
        throw Error('Actualiza el estado antes de enviar.');
      }
      checkSheet(selectedSheet.raw);
      await api.request(`${path()}/${permission.entry ? 'entry' : 'proposal'}`, {
        method: 'PUT',
        revision: selectedSheet.revision,
        sessionNumber: campaign.session_number,
        raw: selectedSheet.raw
      });
      clearSheet();
      await refresh();
      message(permission.entry ? 'Ficha de entrada enviada. Pendiente de aprobación.' : 'Tu propuesta está pendiente de revisión');
    }, sheet);
    const own = panel('Mi historia e imagen', controls.dashboard);
    own.append(node('p', 'El perfil está separado de la ficha. El narrador siempre lo ve; solo los demás jugadores admitidos podrán verlo si él activa la visibilidad.'));
    controls.story = field('Historia del personaje', 'player-story', own, 'textarea');
    controls.story.rows = 7;
    controls.storyCount = node('p', undefined, 'values');
    own.append(controls.storyCount);
    controls.story.addEventListener('input', updateStoryCount);
    controls.saveStory = button('Guardar historia', async () => {
      if (byteLength(controls.story.value) > 8000) {
        throw Error('La historia supera 8.000 bytes UTF-8.');
      }
      const result = await api.request(`${path()}/profile`, {method: 'PUT', revision: profile.profile_revision, body: {story: controls.story.value}});
      profile.profile_revision = result.profile_revision;
      message('Historia guardada.');
    }, own);
    controls.currentImage = node('img');
    controls.currentImage.alt = 'Imagen guardada del personaje';
    controls.currentImage.hidden = true;
    own.append(controls.currentImage);
    controls.imageFile = field('Elegir imagen para reducir', 'player-image', own, 'file');
    controls.imageFile.accept = 'image/jpeg,image/png,image/webp';
    controls.preview = node('img');
    controls.preview.alt = 'Vista previa de la imagen WebP que se enviará';
    controls.preview.hidden = true;
    own.append(controls.preview);
    controls.imageFile.addEventListener('change', () => run(async () => {
      selectedImage = null;
      setImage(controls.preview, null, 'preview');
      const file = controls.imageFile.files[0];
      if (!file) {
        return;
      }
      message('Preparando una WebP reducida. El original no se enviará…');
      const reduced = await reduceImage(file);
      activeSession();
      selectedImage = reduced;
      setImage(controls.preview, reduced, 'preview');
      message(`Vista previa preparada: ${reduced.size} bytes WebP. Pulsa «Subir imagen reducida» para enviarla.`);
    }));
    controls.uploadImage = button('Subir imagen reducida', async () => {
      const result = await api.request(`${path()}/image`, {method: 'PUT', revision: profile.profile_revision, raw: selectedImage, contentType: 'image/webp'});
      profile.profile_revision = result.profile_revision;
      profile.has_image = true;
      setImage(controls.currentImage, selectedImage, 'own');
      clearImage();
      message('Imagen reducida guardada. El archivo original no se ha enviado.');
    }, own);
    controls.deleteImage = button('Borrar mi imagen', async () => {
      await api.request(`${path()}/image`, {method: 'DELETE', revision: profile.profile_revision});
      profile.profile_revision++;
      profile.has_image = false;
      setImage(controls.currentImage, null, 'own');
      message('Imagen borrada. Puedes subir otra.');
    }, own);
    const shared = panel('Perfiles de la mesa', controls.dashboard);
    controls.peers = node('div');
    shared.append(controls.peers);
    const footer = node('footer');
    const narrator = node('a', 'Pantalla del narrador');
    narrator.href = './#narrator';
    footer.append(narrator);
    main.append(footer);
  }

  build();
  controls.access.hidden = true;
  if (!apiBase.trim()) {
    return;
  }
  try {
    store = new SessionStore(sessionStorage, Date.now, 'player');
    if (invitation !== null) {
      // Una invitación nueva no debe abrir por accidente la campaña de otra sesión.
      store.clear();
      sessionStorage.removeItem(progressKey);
    }
    api = new ApiClient(apiBase, store);
    run(connect);
  } catch (error) {
    message(playerError(error), true);
  }
}
