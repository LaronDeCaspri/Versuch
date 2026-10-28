// Ersatz für ../public/js/push.js: Ohne eigenen Server gibt es kein Web-Push.

export class PushClient {
  get state() {
    return 'unsupported';
  }
  async init() {}
  async enable() {
    throw new Error('Push braucht den AeroTrack-Server.');
  }
  async disable() {}
  async test() {}
  sync() {}
}
