window.__ModuleLoader__.load({
  id: 'dsh-session-manager',
  factory: (require) => {
    const react = require('react')

    const NS = 'dsh-session-manager'
    const ARCHIVES_URL = '/session-manager/archives'
    const TRASH_URL = '/session-manager/trash'
    const TRASH_ACTION_URL = '/session-manager/trash'
    const RESTORE_URL = '/session-manager/restore'
    const PURGE_URL = '/session-manager/purge'

    const zh = {
      dialogTitle: '会话管理',
      archiveTab: '归档',
      trashTab: '回收站',
      close: '关闭',
      emptyArchives: '还没有归档的会话',
      emptyTrash: '回收站是空的',
      sessionManager: '会话管理',
      sessionManagerAria: '打开会话管理',
      loading: '加载中...',
      errorPrefix: '操作失败',
      select: '选择',
      cancelSelect: '取消选择',
      selectAll: '全选',
      cancelSelectAll: '取消全选',
      deleteSelected: '删除所选',
      delete: '删除',
      restore: '恢复',
      purge: '清空回收站',
      confirmDelete: '确认删除该会话？删除会移入回收站，不会立即销毁。',
      confirmDeleteSelected: '确认删除所选 {count} 个会话？',
      confirmRestore: '确认恢复该会话？',
      confirmPurge: '确认清空回收站？回收站内容将被彻底删除，无法恢复。',
      missing: '记录已丢失',
      lastUser: '最后一条用户消息',
      lastAssistant: '最后一条助手回复',
      currentHint: '当前会话不能删除',
      emptySelection: '还没有选择会话',
      restoreSuccess: '已恢复',
      trashSuccess: '已移入回收站',
      purgeSuccess: '回收站已清空'
    }

    const en = {
      dialogTitle: 'Session Manager',
      archiveTab: 'Archive',
      trashTab: 'Trash',
      close: 'Close',
      emptyArchives: 'No archived sessions yet',
      emptyTrash: 'Trash is empty',
      sessionManager: 'Session Manager',
      sessionManagerAria: 'Open session manager',
      loading: 'Loading...',
      errorPrefix: 'Operation failed',
      select: 'Select',
      cancelSelect: 'Cancel selection',
      selectAll: 'Select all',
      cancelSelectAll: 'Deselect all',
      deleteSelected: 'Delete selected',
      delete: 'Delete',
      restore: 'Restore',
      purge: 'Empty trash',
      confirmDelete: 'Delete this session? It moves to trash and is not destroyed immediately.',
      confirmDeleteSelected: 'Delete {count} selected sessions?',
      confirmRestore: 'Restore this session?',
      confirmPurge: 'Empty the trash? Trash contents will be permanently deleted and cannot be restored.',
      missing: 'Record lost',
      lastUser: 'Last user message',
      lastAssistant: 'Last assistant reply',
      currentHint: 'Current session cannot be deleted',
      emptySelection: 'No sessions selected',
      restoreSuccess: 'Restored',
      trashSuccess: 'Moved to trash',
      purgeSuccess: 'Trash emptied'
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

    async function fetchJson (path, init = {}) {
      const response = await fetch(path, {
        ...init,
        headers: {
          ...(init.headers || {}),
          'Content-Type': 'application/json; charset=utf-8'
        }
      })
      let data
      try {
        data = await response.json()
      } catch {
        throw new Error('服务器返回了无效响应')
      }
      if (!response.ok || !data.ok) {
        throw new Error((data && data.error && data.error.message) || '操作失败')
      }
      return data
    }

    function timeText (value) {
      if (value === undefined || value === null || value === '') return ''
      const date = typeof value === 'number' ? new Date(value) : new Date(value)
      if (Number.isNaN(date.getTime())) return String(value)
      try {
        return date.toLocaleString()
      } catch {
        return String(value)
      }
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
      return react.createElement('div', {
        className: 'session-manager-action-wrap'
      }, react.createElement('button', {
        className: 'session-manager-action',
        'aria-label': t.sessionManagerAria || '打开会话管理',
        title: t.sessionManager || '会话管理',
        onClick: openModal
      }, wide ? (t.sessionManager || '会话管理') : icon))
    }

    function Overlay (props) {
      const t = props.t || {}
      const useSessions = props.useSessions
      const current = useSessions ? useSessions((state) => state.current) : undefined
      const isOpen = react.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

      const [tab, setTab] = react.useState('archive')
      const [archives, setArchives] = react.useState([])
      const [trash, setTrash] = react.useState([])
      const [selectedIds, setSelectedIds] = react.useState(new Set())
      const [expandedId, setExpandedId] = react.useState(null)
      const [selectionMode, setSelectionMode] = react.useState(false)
      const [loading, setLoading] = react.useState(false)
      const [busyIds, setBusyIds] = react.useState(new Set())
      const [error, setError] = react.useState('')
      const [confirmAction, setConfirmAction] = react.useState(null)

      const startBusy = (id) => {
        const next = new Set(busyIds)
        next.add(id)
        setBusyIds(next)
      }

      const endBusy = (id) => {
        const next = new Set(busyIds)
        next.delete(id)
        setBusyIds(next)
      }

      const loadArchives = react.useCallback(async () => {
        setLoading(true)
        setError('')
        try {
          const data = await fetchJson(ARCHIVES_URL)
          setArchives(data.archives || [])
        } catch (err) {
          setError(err.message || (t.errorPrefix || '操作失败'))
        } finally {
          setLoading(false)
        }
      }, [t.errorPrefix])

      const loadTrash = react.useCallback(async () => {
        setLoading(true)
        setError('')
        try {
          const data = await fetchJson(TRASH_URL)
          setTrash(data.trash || [])
        } catch (err) {
          setError(err.message || (t.errorPrefix || '操作失败'))
        } finally {
          setLoading(false)
        }
      }, [t.errorPrefix])

      const refreshAll = react.useCallback(async () => {
        setLoading(true)
        setError('')
        try {
          const [archiveData, trashData] = await Promise.all([
            fetchJson(ARCHIVES_URL),
            fetchJson(TRASH_URL)
          ])
          setArchives(archiveData.archives || [])
          setTrash(trashData.trash || [])
        } catch (err) {
          setError(err.message || (t.errorPrefix || '操作失败'))
        } finally {
          setLoading(false)
        }
      }, [t.errorPrefix])

      react.useEffect(() => {
        if (!isOpen) {
          setTab('archive')
          setSelectedIds(new Set())
          setExpandedId(null)
          setSelectionMode(false)
          setError('')
          setConfirmAction(null)
          return
        }
        if (tab === 'archive') loadArchives()
        else loadTrash()
      }, [isOpen, tab, loadArchives, loadTrash])

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

      const toggleSelectionMode = () => {
        setSelectionMode(!selectionMode)
        setSelectedIds(new Set())
      }

      const toggleSelect = (id) => {
        const next = new Set(selectedIds)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setSelectedIds(next)
      }

      const toggleSelectAll = () => {
        if (selectedIds.size === archives.length) {
          setSelectedIds(new Set())
        } else {
          setSelectedIds(new Set(archives.map((row) => row.id)))
        }
      }

      const confirmDeleteOne = async (id) => {
        if (current === id) return
        if (!window.confirm(t.confirmDelete || '确认删除该会话？')) return
        startBusy(id)
        try {
          await fetchJson(TRASH_ACTION_URL, {
            method: 'POST',
            body: JSON.stringify({ ids: [id] })
          })
          setError('')
          setArchives(archives.filter((row) => row.id !== id))
          await refreshAll()
        } catch (err) {
          setError(err.message || (t.errorPrefix || '操作失败'))
        } finally {
          endBusy(id)
        }
      }

      const confirmDeleteSelected = async () => {
        const ids = Array.from(selectedIds)
        if (ids.length === 0) return
        if (!window.confirm((t.confirmDeleteSelected || '确认删除所选 {count} 个会话？').replace('{count}', String(ids.length)))) return
        startBusy('*')
        try {
          await fetchJson(TRASH_ACTION_URL, {
            method: 'POST',
            body: JSON.stringify({ ids })
          })
          setError('')
          setSelectedIds(new Set())
          setSelectionMode(false)
          await refreshAll()
        } catch (err) {
          setError(err.message || (t.errorPrefix || '操作失败'))
        } finally {
          endBusy('*')
        }
      }

      const confirmRestoreOne = async (id) => {
        if (!window.confirm(t.confirmRestore || '确认恢复该会话？')) return
        startBusy(id)
        try {
          await fetchJson(RESTORE_URL, {
            method: 'POST',
            body: JSON.stringify({ ids: [id] })
          })
          setError('')
          await refreshAll()
        } catch (err) {
          setError(err.message || (t.errorPrefix || '操作失败'))
        } finally {
          endBusy(id)
        }
      }

      const confirmPurgeAll = async () => {
        if (!window.confirm(t.confirmPurge || '确认清空回收站？回收站内容将被彻底删除，无法恢复。')) return
        startBusy('*')
        try {
          await fetchJson(PURGE_URL, {
            method: 'POST'
          })
          setError('')
          await refreshAll()
        } catch (err) {
          setError(err.message || (t.errorPrefix || '操作失败'))
        } finally {
          endBusy('*')
        }
      }

      const renderPreview = (row) => {
        return react.createElement('div', {
          className: 'session-manager-preview'
        }, row.lastUser ? react.createElement('div', {
          className: 'session-manager-preview-line session-manager-preview-user'
        }, row.lastUser) : null, row.lastAssistant ? react.createElement('div', {
          className: 'session-manager-preview-line session-manager-preview-assistant'
        }, row.lastAssistant) : null)
      }

      const renderArchiveRow = (row) => {
        const isCurrent = current === row.id
        const isBusy = busyIds.has(row.id)
        const isSelected = selectedIds.has(row.id)
        const isExpanded = expandedId === row.id
        const children = []
        if (selectionMode) {
          children.push(react.createElement('input', {
            key: 'check',
            type: 'checkbox',
            checked: isSelected,
            onChange: () => toggleSelect(row.id)
          }))
        }
        const titleText = row.title || row.id
        const metaText = row.updatedAt ? timeText(row.updatedAt) : ''
        const titleButton = react.createElement('button', {
          key: 'title',
          className: 'session-manager-row-title',
          onClick: () => setExpandedId(isExpanded ? null : row.id)
        }, titleText, metaText ? react.createElement('span', {
          className: 'session-manager-row-time'
        }, metaText) : null)
        children.push(titleButton)
        if (row.missing) {
          children.push(react.createElement('div', {
            key: 'missing',
            className: 'session-manager-missing'
          }, t.missing || '记录已丢失'))
        } else {
          children.push(renderPreview(row))
          children.push(react.createElement('div', {
            key: 'actions',
            className: 'session-manager-row-actions'
          }, isCurrent ? react.createElement('span', {
            className: 'session-manager-hint'
          }, t.currentHint || '当前会话不能删除') : !selectionMode ? react.createElement('button', {
            className: 'session-manager-row-action',
            disabled: isBusy,
            onClick: () => confirmDeleteOne(row.id)
          }, t.delete || '删除') : null))
        }
        if (!selectionMode && isExpanded && !row.missing) {
          children.push(renderPreview(row))
        }
        return react.createElement('div', {
          key: row.id,
          className: 'session-manager-row session-manager-archive-row'
        }, children)
      }

      const renderTrashRow = (row) => {
        const isBusy = busyIds.has(row.id)
        return react.createElement('div', {
          key: row.id,
          className: 'session-manager-row session-manager-trash-row'
        }, react.createElement('button', {
          className: 'session-manager-row-title',
          onClick: () => setExpandedId(expandedId === row.id ? null : row.id)
        }, row.title || row.id, react.createElement('span', {
          className: 'session-manager-row-time'
        }, timeText(row.deletedAt || row.updatedAt))), renderPreview(row), react.createElement('div', {
          className: 'session-manager-row-actions'
        }, react.createElement('button', {
          className: 'session-manager-row-action',
          disabled: isBusy,
          onClick: () => confirmRestoreOne(row.id)
        }, t.restore || '恢复')))
      }

      const renderArchiveBody = () => {
        const head = react.createElement('div', {
          className: 'session-manager-toolbar'
        }, react.createElement('button', {
          className: 'session-manager-toolbar-action',
          onClick: toggleSelectionMode
        }, selectionMode ? (t.cancelSelect || '取消选择') : (t.select || '选择')), selectionMode ? react.createElement('button', {
          className: 'session-manager-toolbar-action',
          onClick: toggleSelectAll
        }, selectedIds.size === archives.length ? (t.cancelSelectAll || '取消全选') : (t.selectAll || '全选')) : null, selectionMode ? react.createElement('button', {
          className: 'session-manager-toolbar-action session-manager-danger',
          disabled: selectedIds.size === 0 || busyIds.has('*'),
          onClick: confirmDeleteSelected
        }, `${t.deleteSelected || '删除所选'}（${selectedIds.size}）`) : null)
        if (archives.length === 0) {
          return react.createElement('div', {
            className: 'session-manager-empty'
          }, t.emptyArchives || '还没有归档的会话')
        }
        return react.createElement('div', {
          className: 'session-manager-list'
        }, head, archives.map(renderArchiveRow))
      }

      const renderTrashBody = () => {
        const head = react.createElement('div', {
          className: 'session-manager-toolbar'
        }, react.createElement('button', {
          className: 'session-manager-toolbar-action session-manager-danger',
          disabled: trash.length === 0 || busyIds.has('*'),
          onClick: confirmPurgeAll
        }, t.purge || '清空回收站'))
        if (trash.length === 0) {
          return react.createElement('div', {
            className: 'session-manager-empty'
          }, t.emptyTrash || '回收站是空的')
        }
        return react.createElement('div', {
          className: 'session-manager-list'
        }, head, trash.map(renderTrashRow))
      }

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
      }, t.dialogTitle || '会话管理'), react.createElement('div', {
        className: 'session-manager-tabs'
      }, react.createElement('button', {
        className: tab === 'archive' ? 'session-manager-tab session-manager-tab-active' : 'session-manager-tab',
        onClick: () => setTab('archive')
      }, t.archiveTab || '归档'), react.createElement('button', {
        className: tab === 'trash' ? 'session-manager-tab session-manager-tab-active' : 'session-manager-tab',
        onClick: () => setTab('trash')
      }, t.trashTab || '回收站')), react.createElement('button', {
        className: 'session-manager-close',
        'aria-label': t.close || '关闭',
        onClick: closeModal
      }, '×')), react.createElement('div', {
        className: 'session-manager-body'
      }, error ? react.createElement('div', {
        className: 'session-manager-error'
      }, error) : null, loading ? react.createElement('div', {
        className: 'session-manager-loading'
      }, t.loading || '加载中...') : null, tab === 'archive' ? renderArchiveBody() : renderTrashBody())))
    }

    const styleText = [
      '.session-manager-action-wrap { padding:2px; }',
      '.session-manager-action { display:inline-flex; align-items:center; gap:.5rem; padding:.375rem .65rem; border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.2)); background:var(--dsw-alias-button-elevated-fill, rgba(128,128,128,.05)); color:inherit; border-radius:.5rem; cursor:pointer; font:inherit; width:100%; min-width:0; min-height:36px; }',
      '.session-manager-action:hover { background:var(--dsw-alias-button-floating-hover, rgba(128,128,128,.12)); border-color:var(--dsw-alias-border-l3, rgba(128,128,128,.3)); }',
      '.session-manager-action:active { background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.18)); }',
      '.session-manager-icon { flex:0 0 1em; font-size:1.125rem; }',
      '.session-manager-backdrop { position:fixed; inset:0; z-index:20; display:grid; place-items:center; background:rgba(0,0,0,.45); pointer-events:auto; touch-action:none; }',
      '.session-manager-dialog { width:min(92vw,400px); height:min(58vh,480px); max-height:min(58vh,480px); display:flex; flex-direction:column; background:var(--dsw-specific-panel-fill, var(--dsh-panel-bg, #fff)); color:var(--dsw-alias-label-primary, var(--dsh-panel-fg, #111)); border-radius:12px; box-shadow:0 4px 24px rgba(0,0,0,.25); overflow:hidden; touch-action:auto; }',
      '.session-manager-header { display:flex; align-items:center; gap:.5rem; padding:.75rem 1rem; border-bottom:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2)); flex-shrink:0; }',
      '.session-manager-title { font-size:1rem; font-weight:600; margin:0; min-width:0; flex:1; }',
      '.session-manager-tabs { display:flex; gap:.25rem; }',
      '.session-manager-tab { border:0; background:transparent; color:inherit; font:inherit; padding:.3rem .6rem; border-radius:.375rem; cursor:pointer; font-size:.875rem; }',
      '.session-manager-tab:hover { background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.1)); }',
      '.session-manager-tab-active { background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.15)); font-weight:600; }',
      '.session-manager-close { border:0; background:transparent; color:inherit; font-size:1.25rem; line-height:1; cursor:pointer; padding:.25rem .5rem; border-radius:.375rem; }',
      '.session-manager-close:hover { background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); }',
      '.session-manager-body { flex:1 1 auto; min-height:0; overflow:auto; padding:.75rem 1rem 1rem; }',
      '.session-manager-toolbar { display:flex; align-items:center; gap:.5rem; margin-bottom:.75rem; flex-wrap:wrap; }',
      '.session-manager-toolbar-action { border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25)); background:transparent; color:inherit; font:inherit; font-size:.8125rem; padding:.25rem .6rem; border-radius:.375rem; cursor:pointer; }',
      '.session-manager-toolbar-action:hover { background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.08)); }',
      '.session-manager-toolbar-action:disabled { opacity:.5; cursor:default; }',
      '.session-manager-danger { color:var(--dsw-alias-state-critical, #c0392b); border-color:var(--dsw-alias-state-critical-border, rgba(192,57,43,.4)); }',
      '.session-manager-danger:hover { background:var(--dsw-alias-state-critical-bg-hover, rgba(192,57,43,.08)); }',
      '.session-manager-row { display:flex; flex-direction:column; gap:.25rem; padding:.6rem 0; border-bottom:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.12)); }',
      '.session-manager-row:last-child { border-bottom:0; }',
      '.session-manager-row-title { display:flex; align-items:center; justify-content:space-between; gap:.5rem; border:0; background:transparent; color:inherit; font:inherit; font-size:.9rem; font-weight:500; text-align:left; padding:0; cursor:pointer; min-width:0; }',
      '.session-manager-row-title:hover { opacity:.85; }',
      '.session-manager-row-time { color:inherit; opacity:.55; font-size:.75rem; white-space:nowrap; }',
      '.session-manager-preview { font-size:.8125rem; opacity:.75; overflow:hidden; line-height:1.4; }',
      '.session-manager-preview-line { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere; }',
      '.session-manager-preview-user::before { content:"你："; font-weight:600; opacity:1; }',
      '.session-manager-preview-assistant::before { content:"AI："; font-weight:600; opacity:1; }',
      '.session-manager-row-actions { display:flex; gap:.5rem; align-items:center; margin-top:.125rem; }',
      '.session-manager-row-action { border:0; background:transparent; color:var(--dsw-alias-state-critical, #c0392b); font:inherit; font-size:.8125rem; padding:.2rem .5rem; border-radius:.375rem; cursor:pointer; }',
      '.session-manager-row-action:hover { background:var(--dsw-alias-state-critical-bg-hover, rgba(192,57,43,.08)); }',
      '.session-manager-row-action:disabled { opacity:.5; cursor:default; }',
      '.session-manager-hint { font-size:.75rem; opacity:.55; }',
      '.session-manager-missing { font-size:.8125rem; opacity:.6; padding:.25rem 0; font-style:italic; }',
      '.session-manager-empty { padding:2rem 1rem; text-align:center; opacity:.6; font-size:.9rem; }',
      '.session-manager-loading { padding:1.5rem; text-align:center; opacity:.6; }',
      '.session-manager-error { padding:.5rem .75rem; background:var(--dsw-alias-state-critical-bg-hover, rgba(192,57,43,.08)); border-radius:6px; color:var(--dsw-alias-state-critical, #c0392b); margin-bottom:.75rem; font-size:.875rem; }',
      '.session-manager-list { display:flex; flex-direction:column; }',
      '.session-manager-checkbox { width:16px; height:16px; flex-shrink:0; }'
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
