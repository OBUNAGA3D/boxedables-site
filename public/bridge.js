/* Boxedables bridge: gives the customizer page the same `claude.use(...)` features it has on claude.ai
   (db, user, assets, downloads), backed by Firebase on the real site.
   Needs firebase-app/auth/firestore "compat" scripts and window.BOXEDABLES_FIREBASE loaded first. */
(function () {
  'use strict';
  if (window.claude && window.claude.use) return;   // running on claude.ai: keep Claude's own features

  firebase.initializeApp(window.BOXEDABLES_FIREBASE);
  var auth = firebase.auth(), fs = firebase.firestore();
  try { fs.settings({ ignoreUndefinedProperties: true, merge: true }); } catch (e) {}

  // ---------- sign-in: every feature waits until the visitor is signed in ----------
  var signedIn, whenSignedIn = new Promise(function (r) { signedIn = r; });
  var ADMIN = null;   // promise of true/false
  var PROFILE = {};   // this member's own profile (name and picture they chose)
  function joinedOf(u) { return Date.parse((u.metadata && u.metadata.creationTime) || '') || Date.now(); }
  auth.onAuthStateChanged(function (u) {
    if (!u) { gate(true); return; }
    gate(false); chip(u);
    var ref = fs.collection('profiles').doc(u.uid);
    ref.get().then(function (d) {
      if (d.exists && d.data().name) { PROFILE = d.data(); return ref.set({ updated: Date.now(), joined: PROFILE.joined || joinedOf(u) }, { merge: true }); }
      PROFILE = { name: u.displayName || (u.email ? u.email.split('@')[0] : 'Member'), avatarUrl: u.photoURL || null, joined: joinedOf(u) };
      return ref.set(Object.assign({ updated: Date.now() }, PROFILE), { merge: true });
    }).catch(function () {}).then(function () {
      ADMIN = fs.collection('admins').doc(u.uid).get().then(function (d) { debug(u, d.exists ? 'yes' : 'no (no admins document with this user ID)'); return d.exists; },
        function (e) { debug(u, 'no (database refused: ' + ((e && e.code) || e) + ')'); return false; });
      fs.collection('characters').doc('_admin').get().then(function () { debugDb('ok'); }, function (e) { debugDb('refused: ' + ((e && e.code) || e)); });
      signedIn(u);
    });
  });

  // ---------- account settings for members (used by the page's Account window) ----------
  function provider(u) { return (u.providerData || []).some(function (p) { return p && p.providerId === 'password'; }) ? 'password' : 'google'; }
  function reauth(u, pw) {
    if (provider(u) === 'password') return u.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(u.email, pw || ''));
    return u.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider());
  }
  function delAll(q) { return q.get().then(function (s) { return Promise.all(s.docs.map(function (d) { return d.ref.delete(); })); }); }
  window.BX_ACCOUNT = {
    info: function () {
      var u = auth.currentUser; if (!u) return {};
      return { uid: u.uid, name: PROFILE.name || u.displayName || 'Member', email: u.email || '', provider: provider(u),
        avatarUrl: PROFILE.avatarUrl === undefined ? u.photoURL : PROFILE.avatarUrl, googlePhoto: u.photoURL || null, joined: PROFILE.joined || joinedOf(u) };
    },
    setName: function (n) {
      var u = auth.currentUser; return fs.collection('profiles').doc(u.uid).set({ name: n }, { merge: true })
        .then(function () { PROFILE.name = n; return u.updateProfile({ displayName: n }).catch(function () {}); });
    },
    setAvatar: function (url) {
      var u = auth.currentUser; return fs.collection('profiles').doc(u.uid).set({ avatarUrl: url || null }, { merge: true }).then(function () { PROFILE.avatarUrl = url || null; });
    },
    changePassword: function (oldPw, newPw) { var u = auth.currentUser; return reauth(u, oldPw).then(function () { return u.updatePassword(newPw); }); },
    sendReset: function () { return auth.sendPasswordResetEmail(auth.currentUser.email); },
    signOut: function () { return auth.signOut().then(function () { location.reload(); }); },
    deleteAccount: function (pw) {
      var u = auth.currentUser, id = u.uid;
      return reauth(u, pw).then(function () {
        return Promise.all([
          delAll(fs.collection('data/users/' + id)),
          delAll(fs.collection('community').where('by', '==', id)),
          delAll(fs.collection('shares').where('by', '==', id))
        ]);
      }).then(function () {
        return Promise.all(['chat', 'stats', 'feedback', 'profiles'].map(function (c) { return fs.collection(c).doc(id).delete().catch(function () {}); }));
      }).then(function () { return u.delete(); }).then(function () { setTimeout(function () { location.reload(); }, 1500); });
    }
  };

  // ---------- check panel: open the site with ?check at the end of the address ----------
  var DBG = { user: '', admin: 'checking\u2026', db: 'checking\u2026' };
  function debug(u, a) { DBG.user = (u.email || u.displayName || '') + '\nUser ID: ' + u.uid; DBG.admin = a; paintDebug(); console.info('[Boxedables] Admin:', a, 'User ID:', u.uid); }
  function debugDb(r) { DBG.db = r; paintDebug(); }
  function paintDebug() {
    if (!/[?&]check\b/.test(location.search) || !document.body) return;
    var b = document.getElementById('bxdebug');
    if (!b) { b = document.createElement('pre'); b.id = 'bxdebug'; b.style.cssText = 'position:fixed;left:10px;top:10px;z-index:100000;background:#fff;color:#10302D;border:3px solid #10302D;border-radius:12px;padding:10px 12px;font:13px/1.5 monospace;white-space:pre-wrap;max-width:min(92vw,520px);user-select:all'; document.body.appendChild(b); }
    b.textContent = 'Signed in as ' + DBG.user + '\nAdmin: ' + DBG.admin + '\nDatabase rules: ' + DBG.db;
  }

  // ---------- Firestore doesn't allow arrays inside arrays: wrap them on write, unwrap on read ----------
  function enc(v, inArr) {
    if (Array.isArray(v)) { var a = v.map(function (x) { return enc(x, true); }); return inArr ? { __arr: a } : a; }
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      var o = {}; Object.keys(v).forEach(function (k) { o[k] = enc(v[k], false); }); return o;
    }
    if (typeof v === 'number' && !isFinite(v)) return null;
    return v;
  }
  function dec(v) {
    if (Array.isArray(v)) return v.map(dec);
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      var ks = Object.keys(v); if (ks.length === 1 && ks[0] === '__arr' && Array.isArray(v.__arr)) return v.__arr.map(dec);
      var o = {}; ks.forEach(function (k) { o[k] = dec(v[k]); }); return o;
    }
    return v;
  }

  // ---------- database: the same calls the page makes on claude.ai ----------
  function docSnap(s) {
    return { id: s.id, exists: s.exists, metadata: s.metadata, ref: wrapDoc(s.ref), data: function () { var d = s.data(); return d ? dec(d) : undefined; } };
  }
  function querySnap(s) {
    var docs = s.docs.map(docSnap);
    return { docs: docs, size: docs.length, empty: !docs.length, metadata: s.metadata, forEach: function (f) { docs.forEach(f); } };
  }
  function wrapDoc(r) {
    return {
      id: r.id,
      get: function () { return r.get().then(docSnap); },
      set: function (d, o) { return r.set(enc(d), o || {}); },
      update: function (d) { return r.update(enc(d)); },
      delete: function () { return r.delete(); },
      onSnapshot: function (f, err) { return r.onSnapshot({ includeMetadataChanges: false }, function (s) { f(docSnap(s)); }, err); }
    };
  }
  function wrapQuery(q) {
    return {
      where: function (a, op, b) { return wrapQuery(q.where(a, op, b)); },
      orderBy: function (a, dir) { return wrapQuery(q.orderBy(a, dir)); },
      limit: function (n) { return wrapQuery(q.limit(n)); },
      get: function () { return q.get().then(querySnap); },
      onSnapshot: function (f, err) { return q.onSnapshot(function (s) { f(querySnap(s)); }, err); }
    };
  }
  var DB = {
    collection: function (path) {
      var c = fs.collection(path), w = wrapQuery(c);
      w.doc = function (id) { return wrapDoc(id ? c.doc(id) : c.doc()); };
      return w;
    }
  };

  // ---------- user ----------
  var USER = {
    id: function () { return whenSignedIn.then(function (u) { return u.uid; }); },
    isOwner: function () { return whenSignedIn.then(function () { return ADMIN; }); },
    canEdit: function () { return whenSignedIn.then(function () { return ADMIN; }); },
    me: function () {
      return whenSignedIn.then(function () { var i = window.BX_ACCOUNT.info(); return { id: i.uid, name: i.name, avatarUrl: i.avatarUrl || null }; });
    },
    profiles: function (ids) {
      ids = (ids || []).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
      return Promise.all(ids.map(function (id) {
        return fs.collection('profiles').doc(id).get().then(function (d) { return [id, d.exists ? d.data() : null]; }, function () { return [id, null]; });
      })).then(function (rows) { var o = {}; rows.forEach(function (r) { if (r[1]) o[r[0]] = { name: r[1].name || 'Member', avatarUrl: r[1].avatarUrl || null }; }); return o; });
    }
  };

  // ---------- assets (character files): stored in Firestore in pieces under 1 MB ----------
  var PART = 700000;
  function rid() { var a = new Uint8Array(16); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  var ASSETS = {
    upload: function (blob) {
      return blob.text().then(function (txt) {
        var id = rid(), ref = fs.collection('assets').doc(id), n = Math.ceil(txt.length / PART) || 1, jobs = [];
        for (var i = 0; i < n; i++) jobs.push(ref.collection('parts').doc(String(i)).set({ d: txt.slice(i * PART, (i + 1) * PART) }));
        return Promise.all(jobs).then(function () { return ref.set({ parts: n, size: txt.length, type: blob.type || 'text/plain', created: Date.now() }); })
          .then(function () { return { id: id, url: '/_blob/' + id }; });
      });
    }
  };
  function readAsset(id) {
    var ref = fs.collection('assets').doc(id);
    return ref.get().then(function (d) {
      if (!d.exists) return null;
      var n = d.data().parts, jobs = [];
      for (var i = 0; i < n; i++) jobs.push(ref.collection('parts').doc(String(i)).get());
      return Promise.all(jobs).then(function (ps) { return new Response(ps.map(function (p) { return p.data().d; }).join(''), { status: 200, headers: { 'Content-Type': d.data().type } }); });
    });
  }
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var m = /^(?:https?:\/\/[^/]+)?\/_blob\/([A-Za-z0-9_-]+)$/.exec(url);
    if (!m) return realFetch(input, init);
    return whenSignedIn.then(function () { return readAsset(m[1]); }).then(function (r) { return r || new Response('missing', { status: 404 }); });
  };

  // ---------- downloads ----------
  var DOWNLOADS = {
    save: function (o) {
      var url = URL.createObjectURL(o.data instanceof Blob ? o.data : new Blob([o.data]));
      var a = document.createElement('a'); a.href = url; a.download = o.filename || 'download'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      return Promise.resolve();
    }
  };

  var FEATURES = { db: DB, user: USER, assets: ASSETS, downloads: DOWNLOADS };
  window.claude = {
    use: function (name) {
      if (name === 'downloads') return Promise.resolve(DOWNLOADS);
      return whenSignedIn.then(function () { return FEATURES[name] || null; });
    }
  };

  // ---------- sign-in screen ----------
  var gateEl = null;
  function gate(show) {
    if (!show) { if (gateEl) gateEl.hidden = true; return; }
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { gate(true); }); return; }
    if (!gateEl) gateEl = buildGate();
    gateEl.hidden = false;
  }
  var cssDone = false;
  function addCss() {
    if (cssDone) return; cssDone = true;
    var css = document.createElement('style');
    css.textContent =
      '.bxg{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:rgba(16,48,45,.55);backdrop-filter:blur(6px);font:15px/1.5 Figtree,system-ui,sans-serif;color:#10302D}' +
      '.bxg[hidden]{display:none}' +
      '.bxg .card{width:min(92vw,380px);background:#fff;border:3px solid #10302D;border-radius:24px;padding:26px 24px;box-shadow:0 10px 0 #10302D;text-align:center}' +
      '.bxg h2{font:400 34px/1 "Lilita One",Fredoka,sans-serif;color:#01948C;margin:0 0 10px;letter-spacing:.5px}' +
      '.bxg .bxglogo{display:block;width:min(82%,270px);height:auto;margin:8px auto 0;filter:url(#bxOutline)}.bxg [hidden]{display:none}' +
      '.bxg p{margin:0 0 16px;color:#5E6F6C}' +
      '.bxg button{width:100%;font:600 16px Figtree,sans-serif;border-radius:14px;padding:12px;cursor:pointer;border:3px solid #10302D;margin-top:8px}' +
      '.bxg .g{background:#F9E11B;color:#10302D}.bxg .e{background:#01948C;color:#fff}.bxg .l{background:none;border:0;color:#00716B;text-decoration:underline;padding:6px;margin:0}' +
      '.bxg input{width:100%;box-sizing:border-box;font:16px Figtree,sans-serif;border:2px solid #E7E4D6;border-radius:12px;padding:10px 12px;margin-top:8px}' +
      '.bxg .or{margin:14px 0 2px;color:#5E6F6C;font-size:13px}.bxg .msg{min-height:20px;margin-top:8px;color:#B3261E;font-size:14px}' +
      '.bxchip{position:fixed;right:10px;bottom:10px;z-index:9999;font:600 12px Figtree,sans-serif;background:#fff;border:2px solid #10302D;border-radius:999px;padding:5px 10px;cursor:pointer;color:#10302D;opacity:.8}.bxchip:hover{opacity:1}';
    document.head.appendChild(css);
  }
  function buildGate() {
    addCss();
    var g = document.createElement('div'); g.className = 'bxg';
    g.innerHTML = '<div class="card" role="dialog" aria-labelledby="bxgT"><h2 id="bxgT"><img class="bxglogo" alt="Boxedables" hidden><span>BOXEDABLES</span></h2><p>Sign in to use the customizer.</p>' +
      '<button type="button" class="g">Sign in with Google</button>' +
      '<div class="or">or with email</div>' +
      '<input type="email" placeholder="Email" autocomplete="email"><input type="password" placeholder="Password (6+ characters)" autocomplete="current-password">' +
      '<button type="button" class="e">Sign in</button><button type="button" class="l">New here? Create an account</button>' +
      '<button type="button" class="l f">Forgot password?</button>' +
      '<div class="msg" aria-live="polite"></div></div>';
    document.body.appendChild(g);
    // use the site's own logo picture (falls back to the text if it isn't there yet)
    var useLogo = function () {
      var src = document.querySelector('header.brand .brandlogo, .brandlogo'), im = g.querySelector('.bxglogo');
      if (!src || !src.src) return false;
      im.src = src.src; im.hidden = false; g.querySelector('#bxgT span').hidden = true; return true;
    };
    if (!useLogo()) document.addEventListener('DOMContentLoaded', useLogo);
    var q = function (s) { return g.querySelector(s); }, msg = q('.msg'), creating = false;
    var say = function (e) {
      var c = (e && e.code) || '';
      msg.textContent = /invalid-credential|wrong-password|user-not-found/.test(c) ? 'Email or password is wrong.' :
        /email-already-in-use/.test(c) ? 'That email already has an account. Sign in instead.' :
        /weak-password/.test(c) ? 'Use at least 6 characters.' : /invalid-email/.test(c) ? 'That email doesn’t look right.' :
        /popup-closed|cancelled-popup/.test(c) ? '' : 'Couldn’t sign in. Try again.';
    };
    q('.g').onclick = function () { msg.textContent = ''; auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(say); };
    q('.l').onclick = function () { creating = !creating; q('.e').textContent = creating ? 'Create account' : 'Sign in'; q('.l').textContent = creating ? 'I have an account' : 'New here? Create an account'; msg.textContent = ''; };
    q('.f').onclick = function () {
      var em = q('input[type=email]').value.trim(); if (!em) { msg.textContent = 'Type your email above first.'; return; }
      auth.sendPasswordResetEmail(em).then(function () { msg.style.color = '#00716B'; msg.textContent = 'If that email has an account, a reset link is on its way.'; }, say);
    };
    q('.e').onclick = function () { msg.style.color = '';
      var em = q('input[type=email]').value.trim(), pw = q('input[type=password]').value; msg.textContent = '';
      (creating ? auth.createUserWithEmailAndPassword(em, pw) : auth.signInWithEmailAndPassword(em, pw)).catch(say);
    };
    return g;
  }
  var chipEl = null;
  function chip(u) {
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { chip(u); }); return; }
    addCss();
    return;   // sign out is in the Account window now
    if (!chipEl) { chipEl = document.createElement('button'); chipEl.type = 'button'; chipEl.className = 'bxchip'; document.body.appendChild(chipEl);
      chipEl.onclick = function () { auth.signOut().then(function () { location.reload(); }); }; }
    chipEl.textContent = 'Sign out'; chipEl.title = 'Signed in as ' + (u.email || u.displayName || '') + '\nUser ID: ' + u.uid;
    console.info('[Boxedables] Signed in. User ID:', u.uid);
  }
})();
