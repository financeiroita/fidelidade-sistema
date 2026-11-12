// "Minha conta" do hóspede (ADR 0013). Sem bibliotecas; todo dado da API entra como texto (nunca HTML).
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'fidelidade-hospede';
  var email = '';

  // A sessão fica só nesta aba (sessionStorage) e some ao fechar o navegador.
  var store = {
    get: function () { try { return sessionStorage.getItem(KEY); } catch (e) { return null; } },
    set: function (v) { try { sessionStorage.setItem(KEY, v); } catch (e) { /* sem armazenamento: vale só nesta página */ } },
    clear: function () { try { sessionStorage.removeItem(KEY); } catch (e) { /* nada */ } },
  };
  var token = store.get();

  var nf = new Intl.NumberFormat('pt-BR');
  var fmtPts = function (n) { return nf.format(n); };
  var fmtDay = function (iso) { // "2026-11-12" -> "12/11/2026"
    var p = String(iso).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : '';
  };
  var fmtInstant = function (iso) {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
  };
  var TYPE = {
    EARN_STAY: 'Hospedagem', EARN_CHARGE: 'Consumo', EARN_BONUS: 'Bônus', EARN_CAMPAIGN: 'Campanha',
    REDEEM: 'Resgate', EXPIRE: 'Pontos vencidos', ADJUST: 'Ajuste', REVERSAL: 'Devolução',
  };

  function show(step) {
    ['step-email', 'step-code', 'step-account'].forEach(function (s) { $(s).hidden = s !== step; });
    $('logout').hidden = step !== 'step-account';
    $('fatal').hidden = true;
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function fail(id, msg) { $(id).textContent = msg; $(id).hidden = !msg; }

  function api(method, path, body) {
    var headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = 'Bearer ' + token;
    return fetch(path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, credentials: 'omit' })
      .then(function (r) {
        return r.text().then(function (t) {
          var data = null;
          try { data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
          return { status: r.status, data: data };
        });
      });
  }

  function busy(form, on) {
    var b = form.querySelector('button[type="submit"]');
    b.disabled = on;
  }

  // ---- 1. e-mail ----
  $('form-email').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var v = $('email').value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return fail('email-error', 'Informe um e-mail válido.');
    fail('email-error', '');
    busy(this, true);
    var form = this;
    api('POST', '/me/login/request', { email: v }).then(function (r) {
      busy(form, false);
      if (r.status === 202) {
        email = v;
        $('code-email').textContent = v;
        $('code').value = '';
        fail('code-error', '');
        show('step-code');
        $('code').focus();
      } else if (r.status === 429) fail('email-error', 'Muitas tentativas. Aguarde um minuto e tente de novo.');
      else if (r.status === 503) fail('email-error', 'O acesso pela internet ainda não está disponível. Consulte seus pontos na recepção.');
      else fail('email-error', 'Não foi possível enviar agora. Tente de novo.');
    }).catch(function () { busy(form, false); fail('email-error', 'Sem conexão. Tente de novo.'); });
  });

  // ---- 2. código ----
  $('code').addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 6); });
  $('back').addEventListener('click', function () { show('step-email'); $('email').focus(); });
  $('form-code').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var c = $('code').value;
    if (!/^\d{6}$/.test(c)) return fail('code-error', 'O código tem 6 números.');
    busy(this, true);
    var form = this;
    api('POST', '/me/login/verify', { email: email, code: c }).then(function (r) {
      busy(form, false);
      if (r.status === 200 && r.data && r.data.token) {
        token = r.data.token;
        store.set(token);
        loadAccount();
      } else if (r.status === 429) fail('code-error', 'Muitas tentativas. Aguarde um minuto.');
      else fail('code-error', 'Código incorreto ou vencido. Confira o e-mail ou peça um novo código. Depois de muitas tentativas, o acesso pela internet fica bloqueado por 24 horas; a recepção continua atendendo você.');
    }).catch(function () { busy(form, false); fail('code-error', 'Sem conexão. Tente de novo.'); });
  });

  // ---- 3. conta ----
  function signedOut() {
    token = null;
    store.clear();
    show('step-email');
  }
  $('logout').addEventListener('click', function () {
    var t = token;
    signedOut();
    if (t) fetch('/me/logout', { method: 'POST', headers: { authorization: 'Bearer ' + t }, credentials: 'omit' }).catch(function () {});
  });
  $('copy').addEventListener('click', function () {
    var code = $('ref-code').textContent;
    var btn = this;
    var done = function () { btn.textContent = 'Copiado'; setTimeout(function () { btn.textContent = 'Copiar código'; }, 2000); };
    if (navigator.clipboard) navigator.clipboard.writeText(code).then(done, function () {});
  });

  function renderSummary(s) {
    $('first-name').textContent = s.firstName;
    $('balance').textContent = fmtPts(s.points.available);
    $('pending').hidden = !s.points.pendingWelcome;
    if (s.points.pendingWelcome) {
      $('pending').textContent = '+ ' + fmtPts(s.points.pendingWelcome) + ' pontos de boas-vindas depois da sua primeira estadia';
    }
    $('tier-name').textContent = s.tier.name;
    $('tier-detail').textContent = s.tier.validUntil
      ? 'Válido até ' + fmtDay(s.tier.validUntil)
      : 'Membro desde ' + fmtDay(s.memberSince);
    $('ref-code').textContent = s.referralCode;

    var p = s.progress;
    var pct;
    if (p.nextTier) {
      var span = p.nextTier.minQualifyingPts - p.currentMin;
      pct = span > 0 ? Math.min(100, Math.max(0, ((p.qualifyingPts - p.currentMin) / span) * 100)) : 100;
      $('progress-text').textContent = p.nextTier.missing > 0
        ? 'Faltam ' + fmtPts(p.nextTier.missing) + ' pontos-base para o nível ' + p.nextTier.name + '. Você tem ' + fmtPts(p.qualifyingPts) + '.'
        : 'Você já alcançou o nível ' + p.nextTier.name + '. Ele passa a valer na próxima estadia.';
    } else {
      pct = 100;
      $('progress-text').textContent = 'Você está no nível mais alto. Mantenha ' + fmtPts(p.currentMin) + ' pontos-base em 12 meses para continuar nele.';
    }
    $('progress-fill').style.width = pct.toFixed(1) + '%';
    $('progress-bar').setAttribute('aria-valuenow', String(Math.round(pct)));

    var ul = $('expiring');
    ul.textContent = '';
    s.expiring.forEach(function (e) {
      var li = el('li');
      li.appendChild(el('span', 'what', 'Vencem em ' + fmtDay(e.date)));
      li.appendChild(el('span', 'pts', fmtPts(e.points)));
      ul.appendChild(li);
    });
    $('expiring-empty').hidden = s.expiring.length > 0;
  }

  function renderStatement(rows) {
    var ul = $('statement');
    ul.textContent = '';
    rows.forEach(function (r) {
      var li = el('li');
      var what = el('div', 'what', r.note || TYPE[r.type] || 'Lançamento');
      what.appendChild(el('span', '', fmtInstant(r.at)));
      li.appendChild(what);
      li.appendChild(el('span', 'pts ' + (r.points >= 0 ? 'plus' : 'minus'), (r.points >= 0 ? '+' : '−') + fmtPts(Math.abs(r.points))));
      ul.appendChild(li);
    });
    $('statement-empty').hidden = rows.length > 0;
  }

  function renderRewards(list) {
    var box = $('rewards');
    box.textContent = '';
    list.forEach(function (r) {
      var c = el('article', 'reward');
      c.appendChild(el('h3', '', r.name));
      c.appendChild(el('p', 'cost', fmtPts(r.pointsCost) + ' pontos'));
      if (r.description) c.appendChild(el('p', 'desc', r.description));
      var tag;
      if (r.canRedeem) tag = el('span', 'tag ok', 'Disponível: peça na recepção');
      else if (!r.tierOk) tag = el('span', 'tag', 'A partir do nível ' + r.minTier);
      else tag = el('span', 'tag', 'Faltam ' + fmtPts(r.missingPoints) + ' pontos');
      c.appendChild(tag);
      box.appendChild(c);
    });
    $('rewards-empty').hidden = list.length > 0;
  }

  function loadAccount() {
    Promise.all([api('GET', '/me'), api('GET', '/me/statement?limit=30'), api('GET', '/me/rewards')])
      .then(function (rs) {
        if (rs.some(function (r) { return r.status === 401; })) return signedOut();
        if (rs.some(function (r) { return r.status !== 200; })) throw new Error('falha');
        renderSummary(rs[0].data);
        renderStatement(rs[1].data);
        renderRewards(rs[2].data);
        show('step-account');
      })
      .catch(function () {
        $('fatal').textContent = 'Não foi possível carregar sua conta agora. Tente de novo em instantes.';
        $('fatal').hidden = false;
      });
  }

  if (token) loadAccount();
  else show('step-email');
})();
