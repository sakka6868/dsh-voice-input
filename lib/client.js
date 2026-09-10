// dsh-voice-input — static client half (module-loader factory bundle).
//
// Adapted from the dynamic plugin form for the STATIC plugin shape:
//   - registered via window.__ModuleLoader__.load({ id, factory });
//   - React arrives through require('react');
//   - the dynamic plugin's host.call('voice.proofread') is replaced by
//     fetch('/dsh-voice-input/proofread');
//   - styles use the official per-plugin <style data-plugin-css> pattern
//     instead of the dynamic styles Builtin;
//   - native browser timers replace the dynamic ctx.interval/ctx.timeout.
//
// Component logic, state machine, slot ids, button placement (flex order 1)
// and CSS rules are unchanged from the dynamic form.
window.__ModuleLoader__.load({
  id: 'dsh-voice-input',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');

    const STYLE_TAG_ID = 'dsh-voice-input';
    const PROOFREAD_URL = '/dsh-voice-input/proofread';

    const CSS = [
      '.vc-cell{order:1}',
      '.vc-btn{width:32px;height:32px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));background:transparent;color:var(--dsw-alias-label-secondary,#666);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:background .15s ease,color .15s ease,border-color .15s ease}',
      '.vc-btn:hover{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.06))}',
      '.vc-btn:disabled{opacity:.45;cursor:default}',
      '.vc-btn.vc-rec{border-color:transparent;background:var(--dsw-alias-state-error-primary,#e5484d);color:#fff}',
      '.vc-btn.vc-rec:hover{background:var(--dsw-alias-state-error-primary,#e5484d);filter:brightness(1.1)}',
      '.vc-spin{width:14px;height:14px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));border-top-color:var(--dsw-alias-brand-primary,#4c6ef5);animation:vc-spin .7s linear infinite}',
      '@keyframes vc-spin{to{transform:rotate(360deg)}}',
      '.vc-dock-line{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));box-shadow:0 2px 10px rgba(0,0,0,.06);font-size:12px;color:var(--dsw-alias-label-secondary,#666);max-width:560px}',
      '.vc-error{color:var(--dsw-alias-state-error-primary,#e5484d)}',
    ].join('\n');

    let styleTag = document.querySelector('style[data-plugin-css="' + STYLE_TAG_ID + '"]');
    if (styleTag === null) {
      styleTag = document.createElement('style');
      styleTag.dataset.pluginCss = STYLE_TAG_ID;
      styleTag.textContent = CSS;
      document.head.appendChild(styleTag);
    }

    const svgBase = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };

    function MicIcon() {
      return React.createElement('svg', svgBase,
        React.createElement('path', { d: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z' }),
        React.createElement('path', { d: 'M19 10v2a7 7 0 0 1-14 0v-2' }),
        React.createElement('line', { x1: 12, y1: 19, x2: 12, y2: 23 }))
    }

    function StopIcon() {
      return React.createElement('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'currentColor' },
        React.createElement('rect', { x: 5, y: 5, width: 14, height: 14, rx: 3 }))
    }

    /** Host-side proofread; any failure degrades to the raw transcript. */
    function proofreadRemote(text) {
      return fetch(PROOFREAD_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: text }),
      }).then((res) => res.json()).then((reply) => {
        if (reply && typeof reply.text === 'string' && reply.text.trim().length > 0) return reply.text.trim()
        return text
      }).catch(() => text)
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      const TRANSITIONS = {
        IDLE: { start: { to: 'REQUESTING', effect: 'startRec' } },
        REQUESTING: { started: { to: 'RECORDING' }, denied: { to: 'ERROR', effect: 'recError' } },
        RECORDING: { stop: { to: 'IDLE', effect: 'stopRec' }, ended: { to: 'IDLE', effect: 'autoFinalize' } },
        ERROR: { dismiss: { to: 'IDLE' } },
      }

      const store = {
        state: 'IDLE',
        errorText: '',
        sessionId: null,
        inputActions: null,
        baseDraft: '',
        finalText: '',
        currentDraft: null,
        stopDraft: null,
      }
      const listeners = []
      let recognition = null
      let speechEndTimer = null

      function notify() { listeners.forEach((fn) => { try { fn() } catch (_e) { /* noop */ } }) }
      function set(next, extra) { if (extra !== undefined) Object.assign(store, extra); store.state = next; notify() }
      function dispatch(event) {
        const row = TRANSITIONS[store.state] && TRANSITIONS[store.state][event]
        if (row === undefined) return false
        if (row.effect !== undefined && EFFECTS[row.effect] !== undefined) EFFECTS[row.effect]()
        else set(row.to)
        return true
      }

      function createRecognition() {
        const SR = typeof SpeechRecognition !== 'undefined' ? SpeechRecognition : (typeof webkitSpeechRecognition !== 'undefined' ? webkitSpeechRecognition : null)
        if (SR === null) return null
        const rec = new SR()
        rec.lang = 'zh-CN'
        rec.continuous = true
        rec.interimResults = true
        return rec
      }

      function setDraft(text) {
        const a = store.inputActions
        if (a && typeof a.setDraft === 'function') { try { a.setDraft(text) } catch (_e) { /* noop */ } }
      }

      function finishSilently() {
        set('IDLE')
        const text = store.finalText.trim()
        store.stopDraft = typeof store.currentDraft === 'string' ? store.currentDraft : text
        if (text.length === 0) return
        proofreadRemote(text).then((cleaned) => {
          // Only replace the draft when the user did not touch it meanwhile.
          if (store.state === 'IDLE' && store.currentDraft === store.stopDraft) setDraft(cleaned)
        })
      }

      const EFFECTS = {
        startRec() {
          const rec = createRecognition()
          if (rec === null) { set('ERROR', { errorText: '当前浏览器不支持语音识别（请使用 Edge 或 Chrome）' }); return }
          recognition = rec
          store.finalText = ''
          store.baseDraft = typeof store.currentDraft === 'string' ? store.currentDraft : ''
          store.stopDraft = null
          rec.onstart = () => dispatch('started')
          rec.onresult = (e) => {
            if (store.state !== 'RECORDING' && store.state !== 'REQUESTING') return
            if (speechEndTimer !== null) { clearTimeout(speechEndTimer); speechEndTimer = null }
            let interim = ''
            for (let i = e.resultIndex; i < e.results.length; i += 1) {
              const r = e.results[i]
              if (r.isFinal) store.finalText += r[0].transcript
              else interim += r[0].transcript
            }
            const base = store.baseDraft.trim()
            const body = (store.finalText + interim).trim()
            setDraft(base.length > 0 ? base + ' ' + body : body)
          }
          rec.onspeechend = () => {
            if (speechEndTimer !== null) clearTimeout(speechEndTimer)
            speechEndTimer = setTimeout(() => {
              speechEndTimer = null
              if (store.state === 'RECORDING') { try { rec.stop() } catch (_e) { /* noop */ } }
            }, 1500)
          }
          rec.onerror = (e) => {
            const err = e && e.error
            if (err === 'not-allowed' || err === 'service-not-allowed') {
              set('ERROR', { errorText: '麦克风权限被拒绝，请在浏览器设置中允许' })
            } else if (err === 'no-speech') {
              if (store.state === 'RECORDING' || store.state === 'REQUESTING') set('IDLE')
            } else if (err === 'aborted') {
              /* expected on manual stop */
            } else if (store.state === 'RECORDING' || store.state === 'REQUESTING') {
              set('ERROR', { errorText: '语音识别出错：' + (err || 'unknown') })
            }
          }
          rec.onend = () => {
            if (speechEndTimer !== null) { clearTimeout(speechEndTimer); speechEndTimer = null }
            recognition = null
            if (store.state === 'RECORDING') { dispatch('ended'); return }
            if (store.state === 'REQUESTING') set('IDLE')
          }
          set('REQUESTING')
          try { rec.start() } catch (_e) { set('ERROR', { errorText: '语音识别启动失败' }) }
        },
        recError() { /* errorText already set */ },
        stopRec() {
          if (recognition !== null) { try { recognition.stop() } catch (_e) { /* noop */ } }
          finishSilently()
        },
        autoFinalize() {
          finishSilently()
        },
      }

      function handleKey(e) {
        if (!e) return
        const key = String(e.key || '').toLowerCase()
        const code = String(e.code || '').toLowerCase()
        const isM = key === 'm' || code === 'keym'
        if (!(e.ctrlKey && e.shiftKey && isM)) return
        if (typeof store.sessionId !== 'string' || store.sessionId.length === 0) return
        if (e.preventDefault) { try { e.preventDefault() } catch (_e) { /* noop */ } }
        if (store.state === 'IDLE' || store.state === 'ERROR') dispatch('start')
        else if (store.state === 'RECORDING') dispatch('stop')
      }

      ctx.effect(() => () => {
        if (speechEndTimer !== null) { clearTimeout(speechEndTimer); speechEndTimer = null }
        if (recognition !== null) { try { recognition.abort() } catch (_e) { /* noop */ } recognition = null }
        listeners.length = 0
        store.state = 'IDLE'
      })
      document.addEventListener('keydown', handleKey)
      ctx.effect(() => () => document.removeEventListener('keydown', handleKey))

      function useStore() {
        const [tick, force] = React.useState(0)
        React.useEffect(() => {
          const cb = () => force((n) => n + 1)
          listeners.push(cb)
          return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1) }
        }, [])
        return store
      }

      function VoiceButton(props) {
        const s = useStore()
        if (props) {
          if (typeof props.sessionId === 'string') store.sessionId = props.sessionId
          if (props.inputActions && typeof props.inputActions.setDraft === 'function') store.inputActions = props.inputActions
          if (typeof props.useInput === 'function') {
            try {
              const inputState = props.useInput()
              if (inputState && typeof inputState.draft === 'string') store.currentDraft = inputState.draft
            } catch (_e) { /* noop */ }
          }
        }
        const st = s.state
        if (st === 'IDLE' || st === 'ERROR') {
          return React.createElement('button', { className: 'vc-btn vc-cell', title: '语音输入（Ctrl+Shift+M）', onClick: () => dispatch('start') }, React.createElement(MicIcon, null))
        }
        if (st === 'RECORDING') {
          return React.createElement('button', { className: 'vc-btn vc-rec vc-cell', title: '停止（Ctrl+Shift+M）', onClick: () => dispatch('stop') }, React.createElement(StopIcon, null))
        }
        return React.createElement('span', { className: 'vc-spin vc-cell', style: { display: 'inline-flex', margin: 6 } })
      }

      function VoiceDock() {
        const s = useStore()
        if (s.state !== 'ERROR') return null
        return React.createElement('div', { className: 'vc-dock-line vc-error' }, s.errorText || '出错了')
      }

      slots.inject('conversation.input.right', () => slots.register(
        { name: 'conversation.input.right', id: 'voice-record', order: 10, label: '语音输入' },
        (props) => React.createElement(VoiceButton, props),
      ))
      slots.inject('conversation.input.dock', () => slots.register(
        { name: 'conversation.input.dock', id: 'voice-dock', order: 0, label: '语音识别错误' },
        (props) => React.createElement(VoiceDock, props),
      ))
    }

    exports.apply = apply;
    exports.inject = ['slots'];

    return module.exports;
  },
});
