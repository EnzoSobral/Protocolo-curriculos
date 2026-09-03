const App = (function () {

  /* =========================
     ESTADO DA APLICAÇÃO
     ========================= */

  // Chaves usadas no localStorage
  const STORAGE_DRAFT_KEY = 'protocolo_curriculo_draft_v1';
  const STORAGE_COUNTER_PREFIX = 'protocolo_curriculo_counter_';

  // Ordem das etapas de acordo com o modelo escolhido
  const STEP_ORDER = {
    formacao:    ['personal', 'foto', 'academic', 'experience', 'skills', 'languages', 'extra', 'review'],
    experiencia: ['personal', 'foto', 'experience', 'academic', 'skills', 'languages', 'extra', 'review']
  };

  const STEP_TITLES = {
    personal:    'Dados pessoais',
    foto:        'Foto',
    academic:    'Formação acadêmica',
    experience:  'Experiência profissional',
    skills:      'Habilidades',
    languages:   'Idiomas',
    extra:       'Informações adicionais',
    review:      'Revisão'
  };

  // Estado central do currículo em preenchimento
  function emptyState() {
    return {
      model: 'formacao',
      personal: { nome: '', idade: '', cidade: '', estado: '', email: '', tel: '' },
      foto: null,
      academic: [],
      experience: [],
      skills: [],
      languages: [],
      extra: '',
      protocol: null,
      generatedAt: null
    };
  }

  let state = emptyState();

  let currentStepIndex = 0;
  let cameraStream = null;
  let saveTimer = null;


  /* =========================
     UTILITÁRIOS GERAIS
     ========================= */

  function $(id) { return document.getElementById(id); }

  function uid() {
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  // Remove acentos e caracteres inválidos para nomear o arquivo do PDF
  function slug(nome) {
    const clean = (nome || 'candidato')
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .join('_');

    return clean || 'candidato';
  }

  function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Mostra uma mensagem de sucesso ou erro no topo do formulário
  function toast(message, type) {
    const area = $('toast-area');
    if (!area) return;

    const el = document.createElement('div');
    el.className = 'toast ' + (type === 'error' ? 'error' : 'success');
    el.textContent = message;

    area.innerHTML = '';
    area.appendChild(el);

    window.scrollTo({ top: 0, behavior: 'smooth' });

    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { el.remove(); }, 4500);
  }


  /* =========================
     MODAL DE CONFIRMAÇÃO
     ========================= */

  function showConfirm(text, onConfirm) {
    const modal = $('confirm-modal');
    $('confirm-modal-text').textContent = text;
    modal.style.display = 'flex';

    function cleanup() {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
    }

    const okBtn = $('confirm-modal-ok');
    const cancelBtn = $('confirm-modal-cancel');

    function onOk() { cleanup(); onConfirm(); }
    function onCancel() { cleanup(); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  }


  /* =========================
     ARMAZENAMENTO (localStorage)
     ========================= */

  // Salva o rascunho atual (com debounce para não travar a digitação)
  function saveData() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const toSave = Object.assign({}, state, { savedStepIndex: currentStepIndex });
        localStorage.setItem(STORAGE_DRAFT_KEY, JSON.stringify(toSave));
      } catch (err) {
        // Provavelmente quota excedida (ex: foto muito grande) — não trava o app
        console.warn('Não foi possível salvar o rascunho localmente:', err);
      }
    }, 350);
  }

  // Carrega um rascunho salvo, se existir
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_DRAFT_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  // Remove o rascunho salvo
  function clearData() {
    localStorage.removeItem(STORAGE_DRAFT_KEY);
  }

  // Verifica se existe rascunho e mostra o aviso na tela inicial
  function checkResumeBanner() {
    const draft = loadData();
    const banner = $('resume-banner');

    if (!draft || !draft.personal || (!draft.personal.nome && !draft.academic.length && !draft.experience.length)) {
      banner.style.display = 'none';
      return;
    }

    banner.style.display = 'flex';
    $('resume-banner-text').textContent =
      'Encontramos um currículo não finalizado' +
      (draft.personal.nome ? ' de "' + draft.personal.nome + '"' : '') + '.';

    $('resume-banner-continue').onclick = function () {
      state = Object.assign(emptyState(), draft);
      currentStepIndex = draft.savedStepIndex || 0;
      goToForm(state.model, true);
    };

    $('resume-banner-discard').onclick = function () {
      clearData();
      banner.style.display = 'none';
      toast('Rascunho descartado.', 'success');
    };
  }


  /* =========================
     PROTOCOLO
     ========================= */

  // Gera (e persiste) o próximo número de protocolo do ano atual
  function generateProtocol() {
    const year = new Date().getFullYear();
    const key = STORAGE_COUNTER_PREFIX + year;

    let counter = parseInt(localStorage.getItem(key) || '0', 10);
    counter += 1;

    localStorage.setItem(key, String(counter));

    return year + '-' + String(counter).padStart(6, '0');
  }


  /* =========================
     NAVEGAÇÃO ENTRE TELAS
     ========================= */

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(id).classList.add('active');
  }

  // Abre o formulário do modelo escolhido (equivalente a selectModel)
  function goToForm(model, keepState) {
    if (!keepState) {
      state = emptyState();
      state.model = model;
      currentStepIndex = 0;
    } else {
      state.model = model;
    }

    stopCamera();
    showScreen('screen-form');

    const isFormacao = model === 'formacao';

    $('form-chip').textContent = 'MODELO ' + (isFormacao ? '01' : '02');
    $('proto-model').textContent = isFormacao ? '01-FORMACAO' : '02-EXPERIENCIA';
    $('form-title').textContent = isFormacao ? 'Currículo — Formação Acadêmica' : 'Currículo — Formação Profissional';
    $('form-subtitle').textContent = isFormacao
      ? 'Preencha suas informações para gerar seu currículo.'
      : 'Para candidatos que já possuem experiência profissional.';

    // Formação é obrigatória no modelo 01; experiência é obrigatória no modelo 02
    $('academic-req-mark').style.display = isFormacao ? 'inline' : 'none';
    $('academic-hint').textContent = isFormacao
      ? 'Adicione ao menos uma formação.'
      : 'Opcional — adicione sua formação acadêmica, caso possua.';

    $('exp-req-mark').style.display = isFormacao ? 'none' : 'inline';
    $('exp-hint').textContent = isFormacao
      ? 'Opcional — adicione experiências profissionais, caso possua.'
      : 'Adicione ao menos uma experiência profissional.';

    fillPersonalInputs();
    renderPhotoFromState();
    renderAcademicList();
    renderExperienceList();
    renderSkills();
    renderLanguagesList();
    $('f-extra').value = state.extra || '';

    renderStep();
  }

  function goToWelcome() {
    stopCamera();
    showScreen('screen-welcome');
    checkResumeBanner();
  }


  /* =========================
     ETAPAS (STEPPER)
     ========================= */

  function currentSteps() {
    return STEP_ORDER[state.model];
  }

  function renderStep() {
    const steps = currentSteps();
    const stepName = steps[currentStepIndex];

    document.querySelectorAll('.step').forEach(el => {
      el.classList.toggle('active-step', el.dataset.step === stepName);
    });

    const pct = ((currentStepIndex + 1) / steps.length) * 100;
    $('progress-fill').style.width = pct + '%';
    $('progress-label').textContent =
      'Etapa ' + (currentStepIndex + 1) + ' de ' + steps.length + ' — ' + STEP_TITLES[stepName];

    $('btn-voltar-step').style.visibility = currentStepIndex === 0 ? 'hidden' : 'visible';

    const isReview = stepName === 'review';
    $('btn-continuar-step').style.display = isReview ? 'none' : 'inline-block';
    $('btn-gerar').style.display = isReview ? 'inline-block' : 'none';

    if (isReview) renderReview();

    $('toast-area').innerHTML = '';
  }

  function nextStep() {
    const steps = currentSteps();
    const stepName = steps[currentStepIndex];

    if (!validateStep(stepName)) {
      toast('Corrija os campos destacados antes de continuar.', 'error');
      return;
    }

    if (currentStepIndex < steps.length - 1) {
      currentStepIndex++;
      renderStep();
      saveData();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function previousStep() {
    if (currentStepIndex > 0) {
      currentStepIndex--;
      renderStep();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // Usado pelos botões "Editar" da tela de revisão
  function goToStep(stepName) {
    const steps = currentSteps();
    const idx = steps.indexOf(stepName);
    if (idx >= 0) {
      currentStepIndex = idx;
      renderStep();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }


  /* =========================
     VALIDAÇÃO DE CAMPOS
     ========================= */

  function setError(input, has, customMsgEl) {
    if (!input) return;
    input.classList.toggle('err', has);

    const msg = customMsgEl || (input.parentElement && input.parentElement.querySelector('.errmsg'));
    if (msg) msg.classList.toggle('show', has);
  }

  function validatePersonalData() {
    let valid = true;

    const nome = $('f-nome');
    const idade = $('f-idade');
    const cidade = $('f-cidade');
    const estado = $('f-estado');
    const email = $('f-email');
    const tel = $('f-tel');

    const nomeOk = nome.value.trim().length >= 3;
    setError(nome, !nomeOk);
    if (!nomeOk) valid = false;

    const idadeNum = parseInt(idade.value, 10);
    const idadeOk = idade.value !== '' && idadeNum >= 14 && idadeNum <= 100;
    setError(idade, !idadeOk);
    if (!idadeOk) valid = false;

    const cidadeOk = cidade.value.trim().length >= 2;
    setError(cidade, !cidadeOk);
    if (!cidadeOk) valid = false;

    const estadoOk = !!estado.value;
    setError(estado, !estadoOk);
    if (!estadoOk) valid = false;

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
    setError(email, !emailOk);
    if (!emailOk) valid = false;

    const telDigits = tel.value.replace(/\D/g, '');
    const telOk = telDigits.length === 10 || telDigits.length === 11;
    setError(tel, !telOk);
    if (!telOk) valid = false;

    if (valid) {
      state.personal = {
        nome: nome.value.trim(),
        idade: idade.value.trim(),
        cidade: cidade.value.trim(),
        estado: estado.value,
        email: email.value.trim(),
        tel: tel.value.trim()
      };
    }

    return valid;
  }

  function validateStep(stepName) {
    switch (stepName) {

      case 'personal':
        return validatePersonalData();

      case 'foto':
        return true; // sempre opcional

      case 'academic':
        if (state.model === 'formacao' && state.academic.length === 0) {
          toast('Adicione ao menos uma formação acadêmica para continuar.', 'error');
          return false;
        }
        return true;

      case 'experience':
        if (state.model === 'experiencia' && state.experience.length === 0) {
          toast('Adicione ao menos uma experiência profissional para continuar.', 'error');
          return false;
        }
        return true;

      case 'skills':
        return true;

      case 'languages':
        return true;

      case 'extra':
        state.extra = $('f-extra').value.trim();
        return true;

      default:
        return true;
    }
  }

  // Garante que todos os dados obrigatórios do modelo estão presentes
  function validateAll() {
    for (const stepName of currentSteps()) {
      if (stepName === 'review') continue;
      if (!validateStep(stepName)) return false;
    }
    return true;
  }


  /* =========================
     MÁSCARA DE TELEFONE
     ========================= */

  function bindPhoneMask() {
    $('f-tel').addEventListener('input', e => {
      let v = e.target.value.replace(/\D/g, '').slice(0, 11);

      if (v.length > 10) {
        v = v.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
      } else if (v.length > 5) {
        v = v.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
      } else if (v.length > 2) {
        v = v.replace(/(\d{2})(\d{0,5})/, '($1) $2');
      } else if (v.length > 0) {
        v = v.replace(/(\d{0,2})/, '($1');
      }

      e.target.value = v.replace(/-$/, '').replace(/\)\s$/, ')');
    });
  }

  function fillPersonalInputs() {
    $('f-nome').value = state.personal.nome || '';
    $('f-idade').value = state.personal.idade || '';
    $('f-cidade').value = state.personal.cidade || '';
    $('f-estado').value = state.personal.estado || '';
    $('f-email').value = state.personal.email || '';
    $('f-tel').value = state.personal.tel || '';

    document.querySelectorAll('#curriculo-form .step[data-step="personal"] input, #curriculo-form .step[data-step="personal"] select')
      .forEach(el => el.addEventListener('change', saveData));
  }


  /* =========================
     FOTO — GALERIA
     ========================= */

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      showCameraError('Formato inválido. Envie um arquivo JPG, PNG ou WEBP.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      showCameraError('Imagem muito grande. O limite é 2MB.');
      return;
    }

    hideCameraError();

    const reader = new FileReader();
    reader.onload = ev => {
      state.foto = ev.target.result;
      renderPhotoFromState();
      saveData();
      toast('Foto adicionada com sucesso.', 'success');
    };
    reader.onerror = () => showCameraError('Não foi possível ler o arquivo selecionado.');
    reader.readAsDataURL(file);
  }

  function showCameraError(msg) {
    const el = $('camera-error');
    el.textContent = msg;
    el.style.display = 'block';
  }

  function hideCameraError() {
    $('camera-error').style.display = 'none';
  }


  /* =========================
     FOTO — CÂMERA
     ========================= */

  async function toggleCamera() {
    if (cameraStream) {
      stopCamera();
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showCameraError('Este navegador não permite acesso à câmera. Use a opção "Escolher da galeria".');
      return;
    }

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });

      const video = $('video');
      video.srcObject = cameraStream;
      await video.play();

      hideCameraError();

      video.style.display = 'block';
      $('booth-placeholder').style.display = 'none';
      $('photo-preview').style.display = 'none';

      $('btn-capture').style.display = 'inline-block';
      $('btn-cancel-camera').style.display = 'inline-block';
      $('btn-camera').textContent = 'Desativar câmera';

    } catch (err) {
      cameraStream = null;
      showCameraError('Não foi possível acessar a câmera. Verifique se a permissão foi concedida ao navegador.');
    }
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }

    const video = $('video');
    if (video) video.style.display = 'none';

    const btnCapture = $('btn-capture');
    const btnCancel = $('btn-cancel-camera');
    const btnCamera = $('btn-camera');

    if (btnCapture) btnCapture.style.display = 'none';
    if (btnCancel) btnCancel.style.display = 'none';
    if (btnCamera) btnCamera.textContent = 'Usar câmera';

    // Restaura a visualização de acordo com o que já está salvo no estado
    if (video) renderPhotoFromState();
  }

  function capturePhoto() {
    const video = $('video');
    const canvas = $('capture-canvas');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    state.foto = canvas.toDataURL('image/jpeg', 0.85);

    stopCamera();
    renderPhotoFromState();
    saveData();
    toast('Foto capturada com sucesso.', 'success');
  }

  function confirmRemovePhoto() {
    showConfirm('Tem certeza que deseja remover a foto?', removePhoto);
  }

  function removePhoto() {
    state.foto = null;
    $('f-foto-file').value = '';
    renderPhotoFromState();
    saveData();
  }

  // Atualiza a área de exibição da foto com base no estado atual
  function renderPhotoFromState() {
    const placeholder = $('booth-placeholder');
    const preview = $('photo-preview');
    const retakeBtn = $('btn-retake');

    if (state.foto) {
      preview.src = state.foto;
      preview.style.display = 'block';
      placeholder.style.display = 'none';
      retakeBtn.style.display = 'inline-block';
    } else {
      preview.style.display = 'none';
      preview.src = '';
      placeholder.style.display = 'flex';
      retakeBtn.style.display = 'none';
    }
  }


  /* =========================
     FORMAÇÃO ACADÊMICA (lista dinâmica)
     ========================= */

  function addAcademicFormation() {
    const inst = $('add-inst');
    const curso = $('add-curso');
    const ano = $('add-ano');
    const desc = $('add-desc-academic');
    const errEl = $('academic-errmsg');

    const ok = inst.value.trim().length >= 2 && curso.value.trim().length >= 2 && ano.value.trim().length >= 2;

    if (!ok) {
      errEl.classList.add('show');
      return;
    }
    errEl.classList.remove('show');

    state.academic.push({
      id: uid(),
      instituicao: inst.value.trim(),
      curso: curso.value.trim(),
      ano: ano.value.trim(),
      descricao: desc.value.trim()
    });

    inst.value = '';
    curso.value = '';
    ano.value = '';
    desc.value = '';

    renderAcademicList();
    saveData();
    toast('Formação adicionada.', 'success');
  }

  function removeAcademicFormation(id) {
    showConfirm('Remover esta formação acadêmica?', () => {
      state.academic = state.academic.filter(item => item.id !== id);
      renderAcademicList();
      saveData();
    });
  }

  function renderAcademicList() {
    const list = $('academic-list');
    if (!state.academic.length) {
      list.innerHTML = '<p class="empty-hint">Nenhuma formação adicionada ainda.</p>';
      return;
    }

    list.innerHTML = state.academic.map(item => `
      <div class="item-card">
        <div class="item-info">
          <strong>${escapeHtml(item.curso)}</strong>
          <span>${escapeHtml(item.instituicao)} · ${escapeHtml(item.ano)}</span>
          ${item.descricao ? '<p>' + escapeHtml(item.descricao) + '</p>' : ''}
        </div>
        <div class="item-actions">
          <button type="button" class="remove" onclick="App.removeAcademicFormation('${item.id}')">Excluir</button>
        </div>
      </div>
    `).join('');
  }


  /* =========================
     EXPERIÊNCIA PROFISSIONAL (lista dinâmica)
     ========================= */

  function bindExperienceCheckbox() {
    $('add-atual').addEventListener('change', e => {
      $('add-fim').disabled = e.target.checked;
      if (e.target.checked) $('add-fim').value = '';
    });
  }

  function addProfessionalExperience() {
    const empresa = $('add-empresa');
    const cargo = $('add-cargo');
    const cidade = $('add-exp-cidade');
    const inicio = $('add-inicio');
    const fim = $('add-fim');
    const atual = $('add-atual');
    const desc = $('add-desc-exp');
    const errEl = $('experience-errmsg');

    const ok = empresa.value.trim().length >= 2 && cargo.value.trim().length >= 2 && inicio.value.trim().length >= 4;

    if (!ok) {
      errEl.classList.add('show');
      return;
    }
    errEl.classList.remove('show');

    state.experience.push({
      id: uid(),
      empresa: empresa.value.trim(),
      cargo: cargo.value.trim(),
      cidade: cidade.value.trim(),
      inicio: inicio.value.trim(),
      fim: atual.checked ? '' : fim.value.trim(),
      atual: atual.checked,
      descricao: desc.value.trim()
    });

    empresa.value = '';
    cargo.value = '';
    cidade.value = '';
    inicio.value = '';
    fim.value = '';
    atual.checked = false;
    fim.disabled = false;
    desc.value = '';

    renderExperienceList();
    saveData();
    toast('Experiência adicionada.', 'success');
  }

  function removeProfessionalExperience(id) {
    showConfirm('Remover esta experiência profissional?', () => {
      state.experience = state.experience.filter(item => item.id !== id);
      renderExperienceList();
      saveData();
    });
  }

  function formatPeriodo(item) {
    const fim = item.atual ? 'Atual' : (item.fim || '—');
    return (item.inicio || '—') + ' — ' + fim;
  }

  function renderExperienceList() {
    const list = $('experience-list');
    if (!state.experience.length) {
      list.innerHTML = '<p class="empty-hint">Nenhuma experiência adicionada ainda.</p>';
      return;
    }

    list.innerHTML = state.experience.map(item => `
      <div class="item-card">
        <div class="item-info">
          <strong>${escapeHtml(item.cargo)} · ${escapeHtml(item.empresa)}</strong>
          <span>${escapeHtml(formatPeriodo(item))}${item.cidade ? ' · ' + escapeHtml(item.cidade) : ''}</span>
          ${item.descricao ? '<p>' + escapeHtml(item.descricao) + '</p>' : ''}
        </div>
        <div class="item-actions">
          <button type="button" class="remove" onclick="App.removeProfessionalExperience('${item.id}')">Excluir</button>
        </div>
      </div>
    `).join('');
  }


  /* =========================
     HABILIDADES (chips)
     ========================= */

  function addSkill() {
    const input = $('f-skill-input');
    const value = input.value.trim();

    if (!value) return;

    const exists = state.skills.some(s => s.toLowerCase() === value.toLowerCase());
    if (exists) {
      toast('Essa habilidade já foi adicionada.', 'error');
      input.value = '';
      return;
    }

    state.skills.push(value);
    input.value = '';

    renderSkills();
    saveData();
  }

  function removeSkill(index) {
    state.skills.splice(index, 1);
    renderSkills();
    saveData();
  }

  function renderSkills() {
    const container = $('skills-chips');

    if (!state.skills.length) {
      container.innerHTML = '<p class="empty-hint">Nenhuma habilidade adicionada ainda.</p>';
      return;
    }

    container.innerHTML = state.skills.map((skill, i) => `
      <span class="chip-skill">
        ${escapeHtml(skill)}
        <button type="button" onclick="App.removeSkill(${i})" aria-label="Remover">×</button>
      </span>
    `).join('');
  }


  /* =========================
     IDIOMAS (lista dinâmica)
     ========================= */

  function addLanguage() {
    const idioma = $('add-idioma');
    const nivel = $('add-nivel');
    const errEl = $('languages-errmsg');

    const ok = idioma.value.trim().length >= 2 && !!nivel.value;

    if (!ok) {
      errEl.classList.add('show');
      return;
    }
    errEl.classList.remove('show');

    state.languages.push({
      id: uid(),
      idioma: idioma.value.trim(),
      nivel: nivel.value
    });

    idioma.value = '';
    nivel.value = '';

    renderLanguagesList();
    saveData();
    toast('Idioma adicionado.', 'success');
  }

  function removeLanguage(id) {
    showConfirm('Remover este idioma?', () => {
      state.languages = state.languages.filter(item => item.id !== id);
      renderLanguagesList();
      saveData();
    });
  }

  function renderLanguagesList() {
    const list = $('languages-list');
    if (!state.languages.length) {
      list.innerHTML = '<p class="empty-hint">Nenhum idioma adicionado ainda.</p>';
      return;
    }

    list.innerHTML = state.languages.map(item => `
      <div class="item-card">
        <div class="item-info">
          <strong>${escapeHtml(item.idioma)}</strong>
          <span>${escapeHtml(item.nivel)}</span>
        </div>
        <div class="item-actions">
          <button type="button" class="remove" onclick="App.removeLanguage('${item.id}')">Excluir</button>
        </div>
      </div>
    `).join('');
  }


  /* =========================
     REVISÃO
     ========================= */

  function renderReview() {
    const p = state.personal;

    const academicHtml = state.academic.length
      ? state.academic.map(a => `<p class="review-line"><b>${escapeHtml(a.curso)}</b> — ${escapeHtml(a.instituicao)} (${escapeHtml(a.ano)})</p>`).join('')
      : '<p class="review-empty">Nenhuma formação informada.</p>';

    const experienceHtml = state.experience.length
      ? state.experience.map(e => `<p class="review-line"><b>${escapeHtml(e.cargo)}</b> — ${escapeHtml(e.empresa)} (${escapeHtml(formatPeriodo(e))})</p>`).join('')
      : '<p class="review-empty">Nenhuma experiência informada.</p>';

    const skillsHtml = state.skills.length
      ? `<p class="review-line">${state.skills.map(escapeHtml).join(', ')}</p>`
      : '<p class="review-empty">Nenhuma habilidade informada.</p>';

    const languagesHtml = state.languages.length
      ? state.languages.map(l => `<p class="review-line">${escapeHtml(l.idioma)} — ${escapeHtml(l.nivel)}</p>`).join('')
      : '<p class="review-empty">Nenhum idioma informado.</p>';

    const extraHtml = state.extra
      ? `<p class="review-line">${escapeHtml(state.extra)}</p>`
      : '<p class="review-empty">Nenhuma informação adicional.</p>';

    $('review-content').innerHTML = `

      <div class="review-section">
        <div class="review-section-head">
          <h5>Dados pessoais</h5>
          <button type="button" class="review-edit-btn" onclick="App.goToStep('personal')">Editar</button>
        </div>
        ${state.foto ? `<img class="review-photo" src="${state.foto}" alt="Foto do candidato">` : ''}
        <p class="review-line"><b>${escapeHtml(p.nome)}</b>, ${escapeHtml(p.idade)} anos</p>
        <p class="review-line">${escapeHtml(p.cidade)} / ${escapeHtml(p.estado)}</p>
        <p class="review-line">${escapeHtml(p.email)}</p>
        <p class="review-line">${escapeHtml(p.tel)}</p>
      </div>

      <div class="review-section">
        <div class="review-section-head">
          <h5>Formação acadêmica</h5>
          <button type="button" class="review-edit-btn" onclick="App.goToStep('academic')">Editar</button>
        </div>
        ${academicHtml}
      </div>

      <div class="review-section">
        <div class="review-section-head">
          <h5>Experiência profissional</h5>
          <button type="button" class="review-edit-btn" onclick="App.goToStep('experience')">Editar</button>
        </div>
        ${experienceHtml}
      </div>

      <div class="review-section">
        <div class="review-section-head">
          <h5>Habilidades</h5>
          <button type="button" class="review-edit-btn" onclick="App.goToStep('skills')">Editar</button>
        </div>
        ${skillsHtml}
      </div>

      <div class="review-section">
        <div class="review-section-head">
          <h5>Idiomas</h5>
          <button type="button" class="review-edit-btn" onclick="App.goToStep('languages')">Editar</button>
        </div>
        ${languagesHtml}
      </div>

      <div class="review-section">
        <div class="review-section-head">
          <h5>Informações adicionais</h5>
          <button type="button" class="review-edit-btn" onclick="App.goToStep('extra')">Editar</button>
        </div>
        ${extraHtml}
      </div>
    `;
  }


  /* =========================
     ENVIO DO FORMULÁRIO / GERAÇÃO DO CURRÍCULO
     ========================= */

  function submitForm(e) {
    e.preventDefault();

    if (!validateAll()) {
      toast('Existem campos obrigatórios não preenchidos. Revise as etapas.', 'error');
      return;
    }

    state.protocol = generateProtocol();
    state.generatedAt = new Date();

    renderResume();

    // Mantém o rascunho salvo (permite reabrir e gerar o PDF novamente),
    // mas grava também o registro final como "último currículo gerado".
    saveData();

    showScreen('screen-success');
  }

  // Atualiza a tela de sucesso com os dados do protocolo gerado
  function renderResume() {
    $('protocol-number').textContent = state.protocol || '—';

    const dt = state.generatedAt || new Date();
    $('protocol-date').textContent = 'Data: ' + dt.toLocaleDateString('pt-BR');
    $('protocol-time').textContent = 'Hora: ' + dt.toLocaleTimeString('pt-BR');
  }

  function copyProtocol() {
    const text = state.protocol || '';
    if (!text) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => toast('Protocolo copiado para a área de transferência.', 'success'))
        .catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const temp = document.createElement('textarea');
    temp.value = text;
    document.body.appendChild(temp);
    temp.select();
    try {
      document.execCommand('copy');
      toast('Protocolo copiado para a área de transferência.', 'success');
    } catch (err) {
      toast('Não foi possível copiar automaticamente. Copie manualmente: ' + text, 'error');
    }
    temp.remove();
  }

  function novoCurriculo() {
    clearData();
    state = emptyState();
    currentStepIndex = 0;
    goToWelcome();
  }

  function voltarInicio() {
    goToWelcome();
  }


  /* =========================
     GERAÇÃO DO PDF
     ========================= */

  function generatePDF() {
    if (!window.jspdf) {
      toast('Não foi possível carregar a biblioteca de PDF. Verifique sua conexão.', 'error');
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    const pageH = 297;
    const pageW = 210;
    const sidebarW = 62;
    const mainX = sidebarW + 10;
    const mainRight = pageW - 10;
    const dark = [30, 58, 95];

    const d = state;

    // ---------- Fundo da lateral (apenas na primeira página) ----------
    doc.setFillColor(192, 224, 252);
    doc.rect(0, 0, sidebarW, pageH, 'F');

    let sideY = 14;

    if (d.foto) {
      try {
        doc.addImage(d.foto, 'JPEG', 12, sideY, 38, 38);
        sideY += 46;
      } catch (err) {
        sideY += 2;
      }
    } else {
      sideY += 2;
    }

    function sideTitle(t, y) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(dark[0], dark[1], dark[2]);
      doc.text(t.toUpperCase(), 10, y);
      y += 2.5;
      doc.setDrawColor(dark[0], dark[1], dark[2]);
      doc.setLineWidth(0.3);
      doc.line(10, y, sidebarW - 10, y);
      return y + 5;
    }

    function sideText(txt, y, size = 8, bold = false) {
      if (!txt) return y;
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(dark[0], dark[1], dark[2]);
      const lines = doc.splitTextToSize(txt, sidebarW - 20);
      doc.text(lines, 10, y);
      return y + lines.length * 3.2 + 2;
    }

    sideY = sideTitle('Contato', sideY);
    sideY = sideText(`${d.personal.cidade} / ${d.personal.estado}`, sideY, 7.5, true);
    sideY = sideText(d.personal.tel, sideY, 7.5, false);
    sideY = sideText(d.personal.email, sideY, 7, false);

    if (d.skills.length) {
      sideY = sideTitle('Habilidades', sideY);
      sideY = sideText(d.skills.join(', '), sideY, 7.5, false);
    }

    if (d.languages.length) {
      sideY = sideTitle('Idiomas', sideY);
      d.languages.forEach(l => {
        sideY = sideText(`${l.idioma} — ${l.nivel}`, sideY, 7.5, false);
      });
    }

    // ---------- Área principal ----------
    let y = 20;
    let onFirstPage = true;

    function newPageIfNeeded(minSpace) {
      if (y + minSpace > 280) {
        doc.addPage();
        onFirstPage = false;
        y = 20;
      }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(dark[0], dark[1], dark[2]);
    doc.text((d.personal.nome || '').toUpperCase(), mainX, y);
    y += 10;

    function sectionTitle(t) {
      newPageIfNeeded(16);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(dark[0], dark[1], dark[2]);
      doc.text(t.toUpperCase(), mainX, y);
      y += 3;
      doc.setDrawColor(dark[0], dark[1], dark[2]);
      doc.setLineWidth(0.4);
      doc.line(mainX, y, mainRight, y);
      y += 7;
    }

    function bodyText(txt, size = 9, bold = false, color = [40, 40, 40], lineHeight = 4.2) {
      if (!txt) return;
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(color[0], color[1], color[2]);

      const lines = doc.splitTextToSize(txt, mainRight - mainX);

      lines.forEach(line => {
        newPageIfNeeded(lineHeight + 2);
        doc.text(line, mainX, y);
        y += lineHeight;
      });
    }

    function blockSpacer() { y += 4; }

    function renderAcademicSection() {
      sectionTitle('Formação Acadêmica');
      if (!d.academic.length) {
        bodyText('Não informado.');
        blockSpacer();
        return;
      }
      d.academic.forEach(item => {
        newPageIfNeeded(10);
        bodyText(`${item.curso} — ${item.instituicao}`, 9.5, true);
        bodyText(item.ano, 8, false, [90, 90, 90]);
        if (item.descricao) bodyText(item.descricao, 8.5);
        blockSpacer();
      });
    }

    function renderExperienceSection() {
      sectionTitle('Experiência Profissional');
      if (!d.experience.length) {
        bodyText('Não informado.');
        blockSpacer();
        return;
      }
      d.experience.forEach(item => {
        newPageIfNeeded(10);
        bodyText(`${item.cargo} — ${item.empresa}`, 9.5, true);
        bodyText(formatPeriodo(item) + (item.cidade ? ' · ' + item.cidade : ''), 8, false, [90, 90, 90]);
        if (item.descricao) bodyText(item.descricao, 8.5);
        blockSpacer();
      });
    }

    if (d.model === 'formacao') {
      renderAcademicSection();
      if (d.experience.length) renderExperienceSection();
    } else {
      renderExperienceSection();
      if (d.academic.length) renderAcademicSection();
    }

    if (d.extra) {
      sectionTitle('Informações Adicionais');
      bodyText(d.extra, 8.5);
      blockSpacer();
    }

    if (d.protocol) {
      newPageIfNeeded(10);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 150);
      doc.text('Protocolo: ' + d.protocol, mainX, 291);
    }

    const filename = `curriculo_${slug(d.personal.nome)}.pdf`;
    doc.save(filename);
    toast('PDF gerado com sucesso.', 'success');
  }


  /* =========================
     INICIALIZAÇÃO
     ========================= */

  function initApp() {
    bindPhoneMask();
    bindExperienceCheckbox();

    $('btn-adicionar-academic').addEventListener('click', addAcademicFormation);
    $('btn-adicionar-experience').addEventListener('click', addProfessionalExperience);
    $('btn-adicionar-language').addEventListener('click', addLanguage);

    $('btn-add-skill').addEventListener('click', addSkill);
    $('f-skill-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addSkill();
      }
    });

    $('f-extra').addEventListener('input', () => { state.extra = $('f-extra').value; saveData(); });

    $('curriculo-form').addEventListener('submit', submitForm);

    $('btn-gerar-pdf').addEventListener('click', generatePDF);
    $('btn-copiar-protocolo').addEventListener('click', copyProtocol);
    $('btn-novo-curriculo').addEventListener('click', novoCurriculo);
    $('btn-voltar-inicio').addEventListener('click', voltarInicio);

    checkResumeBanner();
  }

  document.addEventListener('DOMContentLoaded', initApp);


  /* =========================
     API PÚBLICA (usada pelos onclick do HTML)
     ========================= */

  return {
    goToForm,
    goToWelcome,
    goToStep,
    nextStep,
    previousStep,
    handleFileSelect,
    toggleCamera,
    stopCamera,
    capturePhoto,
    confirmRemovePhoto,
    removeAcademicFormation,
    removeProfessionalExperience,
    removeSkill,
    removeLanguage,
    generatePDF,
    copyProtocol
  };

})();
