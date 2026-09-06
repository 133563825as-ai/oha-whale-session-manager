window.__ModuleLoader__.load({
  id: 'dsh-session-manager',
  factory: (require) => {
    const react = require('react')

    const NS = 'dsh-session-manager'
    const ARCHIVES_URL = '/session-manager/archives'
    const TRASH_URL = '/session-manager/trash'

    const zh = {
      dialogTitle: '会话管理',
      archiveTab: '归档',
      trashTab: '回收站',
      close: '关闭',
      emptyArchives: '还没有归档的会话',
      emptyTrash: '回收站是空的',
      sessionManager: '会话管理',
      sessionManagerAria: '打开会话管理'
    }

    const en = {
      dialogTitle: 'Session Manager',
      archiveTab: 'Archive',
      trashTab: 'Trash',
      close: 'Close',
      emptyArchives: 'No archived sessions yet',
      emptyTrash: 'Trash is empty',
      sessionManager: 'Session Manager',
      sessionManagerAria: 'Open session manager'
    }

    const listeners = new Set()
    let open = false
    let historyCreated = false

    function subscribe (listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    function getSnapshot () {
      return open
    }

    function setOpen (next) {
      open = next
      for (const listener of listeners) listener()
    }

    function openModal () {
      if (open) return
      historyCreated = true
      history.pushState({ dshSessionManager: true }, '')
      setOpen(true)
    }

    function closeModal () {
      if (!open) return
      if (historyCreated) {
        historyCreated = false
        history.back()
      }
      setOpen(false)
    }

    const icon = react.createElement('svg', {
      className: 'session-manager-icon',
      viewBox: '0 0 24 24',
      width: '1em',
      height: '1em',
      'aria-hidden': 'true'
    }, react.createElement('path', {
      d: 'M4 5a2 2 0 0 0 2-2h12a2 2 0 0 0 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Zm3 2h10M7 11h10M7 15h6',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '1.6',
      strokeLinecap: 'round'
    }))

    function SidebarAction (props) {
      const t = props.t || {}
      const wide = props.wide !== false
      return react.createElement('button', {
        className: 'session-manager-action',
        'aria-label': t.sessionManagerAria || '打开会话管理',
        title: t.sessionManager || '会话管理',
        onClick: openModal
      }, wide ? (t.sessionManager || '会话管理') : icon)
    }

    function Overlay (props) {
      const t = props.t || {}
      const isOpen = react.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

      react.useEffect(() => {
        if (!isOpen) return
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        const onPopState = () => {
          if (!history.state || !history.state.dshSessionManager) {
            historyCreated = false
            setOpen(false)
          }
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') closeModal()
        }
        window.addEventListener('popstate', onPopState)
        window.addEventListener('keydown', onKeyDown)
        return () => {
          document.body.style.overflow = previousOverflow
          window.removeEventListener('popstate', onPopState)
          window.removeEventListener('keydown', onKeyDown)
        }
      }, [isOpen])

      if (!isOpen) return null

      return react.createElement('div', {
        className: 'session-manager-backdrop',
        onClick: closeModal
      }, react.createElement('div', {
        className: 'session-manager-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t.dialogTitle || '会话管理',
        'aria-labelledby': 'dsh-session-manager-title',
        tabIndex: -1,
        onClick: (event) => event.stopPropagation(),
        onPointerDown: (event) => event.stopPropagation()
      }, react.createElement('div', {
        className: 'session-manager-header'
      }, react.createElement('h2', {
        id: 'dsh-session-manager-title',
        className: 'session-manager-title'
      }, t.dialogTitle || '会话管理'), react.createElement('button', {
        className: 'session-manager-close',
        'aria-label': t.close || '关闭',
        onClick: closeModal
      }, '×')), react.createElement('div', {
        className: 'session-manager-body'
      }, t.emptyArchives || '还没有归档的会话')))
    }

    const styleText = [
      '.session-manager-action { display:inline-flex; align-items:center; gap:.5rem; padding:.375rem .65rem; border:0; background:transparent; color:inherit; border-radius:.5rem; cursor:pointer; font:inherit; width:100%; min-width:0; }',
      '.session-manager-action:hover { background:rgba(128,128,128,.12); }',
      '.session-manager-icon { flex:0 0 1em; font-size:1rem; }',
      '.session-manager-backdrop { position:fixed; inset:0; z-index:10000; display:grid; place-items:center; background:rgba(0,0,0,.48); pointer-events:auto; touch-action:none; }',
      '.session-manager-dialog { width:min(92vw,400px); height:min(58vh,480px); max-height:min(58vh,480px); display:flex; flex-direction:column; background:var(--dsh-panel-bg,#fff); color:var(--dsh-panel-fg,#111); border-radius:12px; box-shadow:0 .5rem 2rem rgba(0,0,0,.2); overflow:hidden; touch-action:auto; }',
      '.session-manager-header { display:flex; align-items:center; justify-content:space-between; gap:.5rem; padding:.75rem 1rem; border-bottom:1px solid rgba(128,128,128,.2); }',
      '.session-manager-title { font-size:1rem; font-weight:600; margin:0; }',
      '.session-manager-close { border:0; background:transparent; color:inherit; font-size:1.25rem; line-height:1; cursor:pointer; padding:.25rem .5rem; border-radius:.375rem; }',
      '.session-manager-close:hover { background:rgba(128,128,128,.12); }',
      '.session-manager-body { flex:1 1 auto; min-height:0; overflow:auto; padding:1rem; }'
    ].join('\n')

    function injectStyle () {
      if (typeof document === 'undefined') return () => {}
      const style = document.createElement('style')
      style.setAttribute('data-dsh-session-manager', '')
      style.textContent = styleText
      document.head.appendChild(style)
      return () => style.remove()
    }

    const inject = ['slots', 'locale']

    function apply (ctx) {
      const removeStyle = injectStyle()
      ctx.effect(() => {
        ctx.locale.register(NS, { zh, en })
        return () => {
          if (ctx.locale.unregister) ctx.locale.unregister(NS)
          removeStyle()
        }
      }, 'dsh-session-manager: locale')

      ctx.slots.inject('sidebar.footer.action', () => {
        return ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'dsh-session-manager',
          order: 10,
          locale: NS
        }, SidebarAction)
      })

      ctx.slots.inject('shell.overlay', () => {
        return ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-session-manager',
          order: 10,
          locale: NS
        }, Overlay)
      })
    }

    return { inject, apply }
  }
})
