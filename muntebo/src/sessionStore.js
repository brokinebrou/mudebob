const session = require('express-session');
const { run, get } = require('./db');

// Store de sessions persistant dans SQLite (les sessions survivent à un redémarrage)
class SqliteStore extends session.Store {
  constructor(ttlMs = 8 * 3600 * 1000) {
    super();
    this.ttl = ttlMs;
    setInterval(() => run('DELETE FROM sessions WHERE expire < ?', Date.now()), 15 * 60 * 1000).unref();
  }
  _expire(sess) {
    return sess && sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + this.ttl;
  }
  get(sid, cb) {
    try {
      const r = get('SELECT data, expire FROM sessions WHERE sid = ?', sid);
      if (!r || r.expire < Date.now()) return cb(null, null);
      cb(null, JSON.parse(r.data));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      run('INSERT INTO sessions(sid, data, expire) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET data=excluded.data, expire=excluded.expire',
        sid, JSON.stringify(sess), this._expire(sess));
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }
  destroy(sid, cb) {
    try { run('DELETE FROM sessions WHERE sid = ?', sid); cb && cb(null); } catch (e) { cb && cb(e); }
  }
  touch(sid, sess, cb) {
    try { run('UPDATE sessions SET expire = ? WHERE sid = ?', this._expire(sess), sid); cb && cb(null); } catch (e) { cb && cb(e); }
  }
}

module.exports = SqliteStore;
