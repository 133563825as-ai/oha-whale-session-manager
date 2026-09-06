window.__ModuleLoader__.load({
  id: 'dsh-session-manager',
  factory: (require) => {
    const react = require('react')

    const NS = 'dsh-session-manager'
    const ARCHIVES_URL = '/session-manager/archives'
    const WORKSPACES_URL = '/session-manager/workspaces'
    const TRASH_URL = '/session-manager/trash'
    const TRASH_ACTION_URL = '/session-manager/trash'
    const UNARCHIVE_URL = '/session-manager/unarchive'
    const RESTORE_URL = '/session-manager/restore'
    const PURGE_URL = '/session-manager/purge'

    const zh = {
      dialogTitle: '会话管理',
      archiveTab: '归档',
      workspaceTab: '工作区',
      trashTab: '回收站',
      close: '关闭',
      emptyArchives: '还没有归档的会话',
      emptyWorkspaces: '还没有工作区',
      emptyTrash: '回收站是空的',
      sessionManager: '会话管理',
      sessionManagerAria: '打开会话管理',
      loading: '加载中...',
      refreshing: '刷新中...',
      pullHint: '下拉刷新',
      errorPrefix: '操作失败',
      select: '选择',
      cancelSelect: '取消选择',
      selectAll: '全选',
      cancelSelectAll: '取消全选',
      deleteSelected: '删除所选',
      unarchiveSelected: '恢复所选',
      delete: '删除',
      restore: '恢复',
      purge: '清空回收站',
      confirmDelete: '确认删除该会话？删除会移入回收站，不会立即销毁。',
      confirmDeleteSelected: '确认删除所选 {count} 个会话？',
      confirmRestore: '确认恢复该会话？',
      confirmUnarchive: '确认将该会话恢复到侧边栏？',
      confirmUnarchiveSelected: '确认恢复所选 {count} 个会话到侧边栏？',
      confirmPurge: '确认清空回收站？回收站内容将被彻底删除，无法恢复。',
      missing: '记录已丢失',
      currentHint: '当前会话',
      emptySelection: '还没有选择会话',
      restoreSuccess: '已恢复',
      unarchiveSuccess: '已恢复到侧边栏',
      trashSuccess: '已移入回收站',
      purgeSuccess: '回收站已清空',
      filterAll: '全部',
      filterDay: '最近一天',
      filterWeek: '最近七天',
      filterOlder: '更早',
      ungrouped: '未分组',
      sessionCount: '{count} 个会话',
      archivedCount: '归档 {count}',
      timeJustNow: '刚刚',
      timeMinutesAgo: '{n} 分钟前',
      timeHoursAgo: '{n} 小时前',
      timeDaysAgo: '{n} 天前'
    }

    const en = {
      dialogTitle: 'Session Manager',
      archiveTab: 'Archive',
      workspaceTab: 'Workspaces',
      trashTab: 'Trash',
      close: 'Close',
      emptyArchives: 'No archived sessions yet',
      emptyWorkspaces: 'No workspaces yet',
      emptyTrash: 'Trash is empty',
      sessionManager: 'Sessions',
      sessionManagerAria: 'Open session manager',
      loading: 'Loading...',
      refreshing: 'Refreshing...',
      pullHint: 'Pull to refresh',
      errorPrefix: 'Operation failed',
      select: 'Select',
      cancelSelect: 'Cancel',
      selectAll: 'All',
      cancelSelectAll: 'Deselect',
      deleteSelected: 'Delete',
      unarchiveSelected: 'Restore',
      delete: 'Delete',
      restore: 'Restore',
      purge: 'Empty trash',
      confirmDelete: 'Delete this session? It moves to trash and is not destroyed immediately.',
      confirmDeleteSelected: 'Delete {count} selected sessions?',
      confirmRestore: 'Restore this session?',
      confirmUnarchive: 'Restore this session to the sidebar?',
      confirmUnarchiveSelected: 'Restore {count} selected sessions to the sidebar?',
      confirmPurge: 'Empty the trash? Trash contents will be permanently deleted and cannot be restored.',
      missing: 'Record lost',
      currentHint: 'Current',
      emptySelection: 'No sessions selected',
      restoreSuccess: 'Restored',
      unarchiveSuccess: 'Restored to sidebar',
      trashSuccess: 'Moved to trash',
      purgeSuccess: 'Trash emptied',
      filterAll: 'All',
      filterDay: 'Last day',
      filterWeek: 'Last 7 days',
      filterOlder: 'Older',
      ungrouped: 'Ungrouped',
      sessionCount: '{count} sessions',
      archivedCount: '{count} archived',
      timeJustNow: 'Just now',
      timeMinutesAgo: '{n} min ago',
      timeHoursAgo: '{n} h ago',
      timeDaysAgo: '{n} d ago'
    }

    /* --- store (modal open state) --- */
    const listeners = new Set()
    let open = false
    let historyCreated = false
    let openSidebar = null

    function subscribe (listener) { listeners.add(listener); return () => listeners.delete(listener) }
    function getSnapshot () { return open }
    function setOpen (next) { open = next; for (const fn of listeners) fn() }

    function openModal () {
      if (open) return
      if (openSidebar) openSidebar()
      historyCreated = true
      history.pushState({ dshSessionManager: true }, '')
      setOpen(true)
    }

    function closeModal () {
      if (!open) return
      if (historyCreated) { historyCreated = false; history.back() }
      setOpen(false)
    }

    const FALLBACK_ERROR = 'Operation failed'

    async function fetchJson (path, init = {}) {
      const res = await fetch(path, { ...init, headers: { ...(init.headers || {}), 'Content-Type': 'application/json; charset=utf-8' } })
      let data
      try { data = await res.json() } catch { throw new Error('Invalid response') }
      if (!res.ok || !data.ok) throw new Error((data && data.error && data.error.message) || 'Operation failed')
      return data
    }

    function timeAgo (value, t) {
      if (!value) return ''
      const ms = typeof value === 'number' ? value : Date.parse(value)
      if (!Number.isFinite(ms)) return ''
      const diff = Date.now() - ms
      const format = (key, params) => t ? t(key, params) : key
      if (diff < 60000) return format('timeJustNow')
      if (diff < 3600000) return format('timeMinutesAgo', { n: Math.floor(diff / 60000) })
      if (diff < 86400000) return format('timeHoursAgo', { n: Math.floor(diff / 3600000) })
      if (diff < 604800000) return format('timeDaysAgo', { n: Math.floor(diff / 86400000) })
      return new Date(ms).toLocaleDateString()
    }

    /* --- SVG icons (no emoji) --- */
    const IconClipboard = react.createElement('svg', { viewBox: '0 0 24 24', width: '1em', height: '1em', 'aria-hidden': 'true' },
      react.createElement('path', { d: 'M8 4h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', fill: 'none', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' }),
      react.createElement('path', { d: 'M10 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1', fill: 'none', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' }),
      react.createElement('path', { d: 'M9 10h6M9 13h4', fill: 'none', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' })
    )

    const IconClose = react.createElement('svg', { viewBox: '0 0 24 24', width: '12', height: '12', 'aria-hidden': 'true' },
      react.createElement('path', { d: 'M18 6 6 18M6 6l12 12', fill: 'none', stroke: 'currentColor', strokeWidth: '2.2', strokeLinecap: 'round' })
    )

    const IconTrash = react.createElement('svg', { viewBox: '0 0 24 24', width: '13', height: '13', 'aria-hidden': 'true' },
      react.createElement('path', { d: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', fill: 'none', stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round' })
    )

    const IconRestore = react.createElement('svg', { viewBox: '0 0 24 24', width: '13', height: '13', 'aria-hidden': 'true' },
      react.createElement('path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', fill: 'none', stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round' }),
      react.createElement('path', { d: 'M3 3v5h5', fill: 'none', stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round' })
    )

    /* --- i18n: DSH passes t() as a function, but this plugin also uses t.key --- */
    function makeT (propsT) {
      const tr = typeof propsT === 'function'
        ? propsT
        : (key, params) => {
            const value = zh[key] ?? en[key] ?? key
            if (!params) return value
            return String(value).replace(/\{(\w+)\}/g, (_, name) => params[name] ?? '')
          }
      return new Proxy(tr, {
        get: (target, key) => (typeof key === 'string' ? tr(key) : target[key])
      })
    }

    /* --- sidebar button --- */
    function SidebarAction (props) {
      const t = makeT(props.t)
      const wide = props.wide !== false
      const logo = react.createElement('img', { src: '/api-dashboard/icon', className: 'sm-action-logo', alt: '哦鲸鲸', onError: (e) => { e.currentTarget.style.display = 'none' } })
      const content = wide
        ? react.createElement('span', { className: 'sm-action-content' },
            logo,
            react.createElement('span', { className: 'sm-action-text' },
              react.createElement('span', { className: 'sm-action-title' }, '哦鲸鲸'),
              react.createElement('span', { className: 'sm-action-sub' }, t.sessionManager)
            )
          )
        : logo
      return react.createElement('div', { className: 'sm-action-wrap' },
        react.createElement('button', {
          className: 'sm-action',
          'aria-label': t.sessionManagerAria,
          title: t.sessionManager,
          onClick: openModal
        }, content)
      )
    }

    /* --- main overlay / sidebar panel --- */
    function Overlay (props) {
      const t = makeT(props.t)
      const useSessions = props.useSessions
      const current = useSessions ? useSessions((s) => s.current) : undefined
      const isOpen = react.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

      const [tab, setTab] = react.useState('archive')
      const [archives, setArchives] = react.useState([])
      const [workspaces, setWorkspaces] = react.useState([])
      const [trash, setTrash] = react.useState([])
      const [selectedIds, setSelectedIds] = react.useState(new Set())
      const [selectionMode, setSelectionMode] = react.useState(false)
      const [loading, setLoading] = react.useState(false)
      const [refreshing, setRefreshing] = react.useState(false)
      const [filter, setFilter] = react.useState('all')
      const [pullY, setPullY] = react.useState(0)
      const [busyIds, setBusyIds] = react.useState(new Set())
      const [error, setError] = react.useState('')
      const loadedRef = react.useRef({ archive: false, workspace: false, trash: false })
      const bodyRef = react.useRef(null)
      const touchStartYRef = react.useRef(0)

      const startBusy = (id) => setBusyIds(prev => { const n = new Set(prev); n.add(id); return n })
      const endBusy = (id) => setBusyIds(prev => { const n = new Set(prev); n.delete(id); return n })

      const loadArchives = react.useCallback(async (manual = false) => {
        if (!manual && loadedRef.current.archive) return
        if (!loadedRef.current.archive) setLoading(true)
        else setRefreshing(true)
        setError('')
        try {
          const d = await fetchJson(ARCHIVES_URL)
          setArchives(d.archives || [])
          loadedRef.current.archive = true
        } catch (e) {
          setError(e.message || FALLBACK_ERROR)
        } finally {
          setLoading(false)
          setRefreshing(false)
        }
      }, [])

      const loadWorkspaces = react.useCallback(async (manual = false) => {
        if (!manual && loadedRef.current.workspace) return
        if (!loadedRef.current.workspace) setLoading(true)
        else setRefreshing(true)
        setError('')
        try {
          const d = await fetchJson(WORKSPACES_URL)
          setWorkspaces(d.workspaces || [])
          loadedRef.current.workspace = true
        } catch (e) {
          setError(e.message || FALLBACK_ERROR)
        } finally {
          setLoading(false)
          setRefreshing(false)
        }
      }, [])

      const loadTrash = react.useCallback(async (manual = false) => {
        if (!manual && loadedRef.current.trash) return
        if (!loadedRef.current.trash) setLoading(true)
        else setRefreshing(true)
        setError('')
        try {
          const d = await fetchJson(TRASH_URL)
          setTrash(d.trash || [])
          loadedRef.current.trash = true
        } catch (e) {
          setError(e.message || FALLBACK_ERROR)
        } finally {
          setLoading(false)
          setRefreshing(false)
        }
      }, [])

      const refreshAll = react.useCallback(async () => {
        const tasks = []
        if (loadedRef.current.archive) tasks.push(loadArchives(true))
        if (loadedRef.current.workspace) tasks.push(loadWorkspaces(true))
        if (loadedRef.current.trash) tasks.push(loadTrash(true))
        await Promise.all(tasks)
      }, [loadArchives, loadWorkspaces, loadTrash])

      const manualRefresh = react.useCallback(() => {
        if (tab === 'archive') return Promise.all([loadArchives(true), loadWorkspaces(true)])
        if (tab === 'trash') return loadTrash(true)
      }, [tab, loadArchives, loadWorkspaces, loadTrash])

      react.useEffect(() => {
        if (!isOpen) {
          setTab('archive')
          setSelectedIds(new Set())
          setSelectionMode(false)
          setError('')
          return
        }
        if (tab === 'archive' && !loadedRef.current.archive) {
          loadArchives()
          if (!loadedRef.current.workspace) loadWorkspaces()
        } else if (tab === 'trash' && !loadedRef.current.trash) loadTrash()
      }, [isOpen, tab, loadArchives, loadWorkspaces, loadTrash])

      react.useEffect(() => {
        if (!isOpen) return
        const prev = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        const onPop = () => { if (!history.state?.dshSessionManager) { historyCreated = false; setOpen(false) } }
        const onKey = (e) => { if (e.key === 'Escape') closeModal() }
        window.addEventListener('popstate', onPop)
        window.addEventListener('keydown', onKey)
        return () => { document.body.style.overflow = prev; window.removeEventListener('popstate', onPop); window.removeEventListener('keydown', onKey) }
      }, [isOpen])

      const toggleSelect = (id) => { const n = new Set(selectedIds); n.has(id) ? n.delete(id) : n.add(id); setSelectedIds(n) }
      const filteredArchives = (() => {
        const cutoffDay = Date.now() - 86400000
        const cutoffWeek = Date.now() - 604800000
        return archives.filter((row) => {
          const ms = typeof row.updatedAt === 'number' ? row.updatedAt : Date.parse(row.updatedAt || '')
          if (!Number.isFinite(ms)) return filter === 'all'
          if (filter === 'all') return true
          if (filter === 'day') return ms >= cutoffDay
          if (filter === 'week') return ms >= cutoffWeek
          return ms < cutoffWeek
        })
      })()
      const toggleSelectAll = () => { setSelectedIds(selectedIds.size === filteredArchives.length ? new Set() : new Set(filteredArchives.map((r) => r.id))) }

      const doTrash = async (ids) => {
        ids.forEach(startBusy)
        try { await fetchJson(TRASH_ACTION_URL, { method: 'POST', body: JSON.stringify({ ids }) }); setError(''); await refreshAll() }
        catch (e) { setError(e.message || FALLBACK_ERROR) } finally { ids.forEach(endBusy) }
      }
      const doUnarchive = async (ids) => {
        ids.forEach(startBusy)
        try { await fetchJson(UNARCHIVE_URL, { method: 'POST', body: JSON.stringify({ ids }) }); setError(''); await refreshAll() }
        catch (e) { setError(e.message || FALLBACK_ERROR) } finally { ids.forEach(endBusy) }
      }
      const doRestore = async (ids) => {
        ids.forEach(startBusy)
        try { await fetchJson(RESTORE_URL, { method: 'POST', body: JSON.stringify({ ids }) }); setError(''); await refreshAll() }
        catch (e) { setError(e.message || FALLBACK_ERROR) } finally { ids.forEach(endBusy) }
      }
      const doPurge = async () => {
        startBusy('*')
        try { await fetchJson(PURGE_URL, { method: 'POST' }); setError(''); await refreshAll() }
        catch (e) { setError(e.message || t.errorPrefix) } finally { endBusy('*') }
      }

      const onTouchStart = (e) => { touchStartYRef.current = e.touches[0].clientY }
      const onTouchMove = (e) => {
        const el = bodyRef.current
        if (!el || el.scrollTop > 0) return
        const delta = e.touches[0].clientY - touchStartYRef.current
        if (delta > 0) setPullY(Math.min(delta, 88))
      }
      const onTouchEnd = () => {
        if (pullY > 48) manualRefresh()
        setPullY(0)
      }

      /* --- card renderer --- */
      function renderCard (row, kind) {
        const isCurrent = current === row.id
        const isBusy = busyIds.has(row.id) || busyIds.has('*')
        const isSelected = selectedIds.has(row.id)
        const cls = ['sm-card']
        if (isCurrent) cls.push('sm-card-current')
        if (isSelected) cls.push('sm-card-selected')

        const title = row.title || (row.id ? row.id.slice(0, 8) : '?')
        const firstMsg = row.firstUser || ''
        const lastMsg = row.lastAssistant || row.lastUser || ''

        const children = []

        if (selectionMode && kind === 'archive') {
          children.push(react.createElement('input', { key: 'cb', type: 'checkbox', className: 'sm-cb', checked: isSelected, onChange: () => toggleSelect(row.id), onClick: (e) => e.stopPropagation() }))
        }

        const iconBg = isCurrent ? '#4f7cff' : (row.missing ? '#9ca0aa' : '#eef2ff')
        children.push(react.createElement('div', { key: 'icon', className: 'sm-card-icon', style: { background: iconBg } },
          react.createElement('img', { className: 'sm-card-icon-img', src: '/session-manager/icon', alt: '哦鲸鲸' })
        ))

        const infoChildren = []
        infoChildren.push(react.createElement('div', { key: 'title', className: 'sm-card-title' }, title))
        if (row.missing) {
          infoChildren.push(react.createElement('div', { key: 'miss', className: 'sm-card-miss' }, t.missing))
        } else {
          if (firstMsg) infoChildren.push(react.createElement('div', { key: 'first', className: 'sm-card-preview' }, firstMsg))
          if (lastMsg && lastMsg !== firstMsg) infoChildren.push(react.createElement('div', { key: 'last', className: 'sm-card-preview sm-card-preview-sub' }, lastMsg))
        }
        children.push(react.createElement('div', { key: 'info', className: 'sm-card-info' }, infoChildren))

        const rightChildren = []
        const timeStr = timeAgo(kind === 'trash' ? (row.deletedAt || row.updatedAt) : row.updatedAt, t)
        if (timeStr) rightChildren.push(react.createElement('div', { key: 'time', className: 'sm-card-time' }, timeStr))
        if (kind === 'archive' && !row.missing && !selectionMode) {
          if (isCurrent) {
            rightChildren.push(react.createElement('span', { key: 'cur', className: 'sm-card-hint' }, t.currentHint))
          } else {
            rightChildren.push(react.createElement('button', {
              key: 'up', className: 'sm-card-action sm-card-action-ok', disabled: isBusy,
              onClick: (e) => { e.stopPropagation(); if (!window.confirm(t.confirmUnarchive)) return; doUnarchive([row.id]) }
            }, IconRestore))
            rightChildren.push(react.createElement('button', {
              key: 'del', className: 'sm-card-action', disabled: isBusy,
              onClick: (e) => { e.stopPropagation(); if (!window.confirm(t.confirmDelete)) return; doTrash([row.id]) }
            }, IconTrash))
          }
        }
        if (kind === 'trash') {
          rightChildren.push(react.createElement('button', {
            key: 'restore', className: 'sm-card-action sm-card-action-ok', disabled: isBusy,
            onClick: (e) => { e.stopPropagation(); if (!window.confirm(t.confirmRestore)) return; doRestore([row.id]) }
          }, IconRestore))
        }
        if (rightChildren.length) children.push(react.createElement('div', { key: 'right', className: 'sm-card-right' }, rightChildren))

        return react.createElement('div', { key: row.id, className: cls.join(' '), onClick: selectionMode && kind === 'archive' ? () => toggleSelect(row.id) : undefined }, children)
      }

      function renderWorkspaceGroup (ws, rows) {
        const children = []
        children.push(react.createElement('div', { key: 'icon', className: 'sm-ws-icon' },
          react.createElement('img', { className: 'sm-ws-icon-img', src: '/session-manager/icon', alt: '哦鲸鲸' })
        ))
        const info = []
        info.push(react.createElement('div', { key: 'title', className: 'sm-ws-title' }, ws.title))
        info.push(react.createElement('div', { key: 'path', className: 'sm-ws-meta' }, ws.path))
        info.push(react.createElement('div', { key: 'count', className: 'sm-ws-meta' }, t.sessionCount.replace('{count}', String(ws.sessionCount)) + ' · ' + t.archivedCount.replace('{count}', String(ws.archivedCount))))
        children.push(react.createElement('div', { key: 'info', className: 'sm-ws-info' }, info))
        return react.createElement('div', { key: 'ws-' + ws.id, className: 'sm-ws-group' },
          react.createElement('div', { className: 'sm-ws-header' }, children),
          react.createElement('div', { className: 'sm-list' }, rows.map((r) => renderCard(r, 'archive')))
        )
      }

      function renderUngroupedGroup (rows) {
        const children = [
          react.createElement('div', { key: 'icon', className: 'sm-ws-icon' },
            react.createElement('img', { className: 'sm-ws-icon-img', src: '/session-manager/icon', alt: '哦鲸鲸' })
          ),
          react.createElement('div', { key: 'info', className: 'sm-ws-info' },
            react.createElement('div', { key: 'title', className: 'sm-ws-title' }, t.ungrouped),
            react.createElement('div', { key: 'count', className: 'sm-ws-meta' }, t.archivedCount.replace('{count}', String(rows.length)))
          )
        ]
        return react.createElement('div', { key: 'ungrouped', className: 'sm-ws-group' },
          react.createElement('div', { className: 'sm-ws-header' }, children),
          react.createElement('div', { className: 'sm-list' }, rows.map((r) => renderCard(r, 'archive')))
        )
      }

      function renderArchiveGroups () {
        const byPath = new Map(workspaces.map((ws) => [ws.path, ws]))
        const groups = []
        for (const ws of workspaces) {
          const rows = filteredArchives.filter((row) => row.cwd === ws.path)
          if (rows.length > 0) groups.push({ ws, rows })
        }
        const assigned = new Set(workspaces.map((ws) => ws.path))
        const ungroupedRows = filteredArchives.filter((row) => !assigned.has(row.cwd))
        const out = groups.map(({ ws, rows }) => renderWorkspaceGroup(ws, rows))
        if (ungroupedRows.length > 0) out.push(renderUngroupedGroup(ungroupedRows))
        return out
      }

      /* --- toolbar --- */
      function renderToolbar () {
        const btns = []
        if (tab === 'archive') {
          btns.push(react.createElement('button', { key: 'sel', className: 'sm-tool-btn', onClick: () => { setSelectionMode(!selectionMode); setSelectedIds(new Set()) } }, selectionMode ? t.cancelSelect : t.select))
          if (selectionMode) {
            btns.push(react.createElement('button', { key: 'all', className: 'sm-tool-btn', onClick: toggleSelectAll }, selectedIds.size === filteredArchives.length ? t.cancelSelectAll : t.selectAll))
            btns.push(react.createElement('button', { key: 'up', className: 'sm-tool-btn', disabled: selectedIds.size === 0, onClick: () => { if (!window.confirm(t.confirmUnarchiveSelected.replace('{count}', String(selectedIds.size)))) return; doUnarchive(Array.from(selectedIds)); setSelectionMode(false) } }, t.unarchiveSelected + ' (' + selectedIds.size + ')'))
            btns.push(react.createElement('button', { key: 'del', className: 'sm-tool-btn sm-tool-danger', disabled: selectedIds.size === 0, onClick: () => { if (!window.confirm(t.confirmDeleteSelected.replace('{count}', String(selectedIds.size)))) return; doTrash(Array.from(selectedIds)); setSelectionMode(false) } }, t.deleteSelected + ' (' + selectedIds.size + ')'))
          }
          btns.push(react.createElement('button', { key: 'refresh', className: 'sm-tool-btn', disabled: refreshing, onClick: () => manualRefresh() }, refreshing ? t.refreshing : t.pullHint))
        } else {
          btns.push(react.createElement('button', { key: 'refresh', className: 'sm-tool-btn', disabled: refreshing, onClick: () => manualRefresh() }, refreshing ? t.refreshing : t.pullHint))
          btns.push(react.createElement('button', { key: 'purge', className: 'sm-tool-btn sm-tool-danger', disabled: trash.length === 0, onClick: () => { if (!window.confirm(t.confirmPurge)) return; doPurge() } }, t.purge))
        }
        return react.createElement('div', { className: 'sm-toolbar' }, btns)
      }

      function renderFilter () {
        const options = [
          ['all', t.filterAll],
          ['day', t.filterDay],
          ['week', t.filterWeek],
          ['older', t.filterOlder]
        ]
        return react.createElement('div', { className: 'sm-filter' },
          options.map(([key, label]) => react.createElement('button', {
            key, className: filter === key ? 'sm-filter-btn sm-filter-on' : 'sm-filter-btn', onClick: () => setFilter(key)
          }, label))
        )
      }

      if (!isOpen) return null

      const bodyChildren = []
      if (pullY > 0 || refreshing) bodyChildren.push(react.createElement('div', { className: 'sm-pull' }, refreshing ? t.refreshing : t.pullHint))

      let body
      if (loading && (tab === 'archive' ? archives.length === 0 : trash.length === 0)) {
        body = react.createElement('div', { className: 'sm-loading' }, t.loading)
      } else if (error && (tab === 'archive' ? archives.length === 0 : trash.length === 0)) {
        body = react.createElement('div', { className: 'sm-error' }, error)
      } else if (tab === 'archive') {
        body = filteredArchives.length === 0
          ? react.createElement('div', { className: 'sm-empty' }, archives.length === 0 ? t.emptyArchives : t.emptyArchives)
          : react.createElement('div', { className: 'sm-archive-groups' }, renderArchiveGroups())
      } else {
        body = trash.length === 0
          ? react.createElement('div', { className: 'sm-empty' }, t.emptyTrash)
          : react.createElement('div', { className: 'sm-list' }, trash.map((r) => renderCard(r, 'trash')))
      }
      bodyChildren.push(body)

      return react.createElement('div', { className: 'sm-backdrop', onClick: closeModal },
        react.createElement('div', {
          className: 'sm-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': t.dialogTitle,
          onClick: (e) => e.stopPropagation(), onPointerDown: (e) => e.stopPropagation()
        },
          react.createElement('div', { className: 'sm-header' },
            react.createElement('h2', { className: 'sm-title' }, t.dialogTitle),
            react.createElement('button', { className: 'sm-close', 'aria-label': t.close, onClick: closeModal }, IconClose)
          ),
          react.createElement('div', { className: 'sm-tabs' },
            react.createElement('button', { className: tab === 'archive' ? 'sm-tab sm-tab-on' : 'sm-tab', onClick: () => setTab('archive') }, t.archiveTab),
            react.createElement('button', { className: tab === 'trash' ? 'sm-tab sm-tab-on' : 'sm-tab', onClick: () => setTab('trash') }, t.trashTab)
          ),
          react.createElement('div', {
            ref: bodyRef,
            className: 'sm-body' + (pullY > 0 ? ' sm-pulling' : ''),
            style: pullY > 0 ? { transform: 'translateY(' + pullY + 'px)' } : undefined,
            onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd
          },
            tab === 'archive' ? react.createElement(react.Fragment, null, renderFilter()) : null,
            renderToolbar(),
            bodyChildren
          )
        )
      )
    }

    /* --- styles --- */
    const CSS = `
@keyframes sm-fadein{from{opacity:0}to{opacity:1}}
@keyframes sm-pop{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}

.sm-action-wrap{padding:2px}
.sm-action{display:inline-flex;align-items:center;gap:.5rem;padding:.375rem .65rem;border:1px solid var(--dsw-alias-border-l2,#e7e8ec);background:var(--dsw-alias-button-elevated-fill,#fff);color:var(--dsw-alias-label-primary,#17181c);border-radius:10px;cursor:pointer;font:inherit;width:100%;min-width:0;min-height:36px;transition:background .12s ease,box-shadow .2s ease}
.sm-action:hover{background:var(--dsw-alias-button-floating-hover,#f5f6f8);box-shadow:0 2px 8px rgba(0,0,0,.06)}
.sm-action:active{transform:scale(.985);opacity:.9}
.sm-action svg{flex:none;font-size:1.125rem}
.sm-action-content{display:inline-flex;align-items:center;gap:.5rem;min-width:0;flex:1}
.sm-action-logo{width:20px;height:20px;border-radius:6px;object-fit:contain;flex:none}
.sm-action-text{display:flex;flex-direction:column;align-items:flex-start;min-width:0;line-height:1.15}
.sm-action-title{font-size:13px;font-weight:700;color:var(--dsw-alias-label-primary,#17181c);white-space:nowrap}
.sm-action-sub{font-size:10px;color:var(--dsw-alias-label-secondary,#777b84);white-space:nowrap}

[data-shell-overlay]{z-index:100!important}

.sm-backdrop{position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:rgba(0,0,0,.35);animation:sm-fadein .15s ease-out;pointer-events:auto;touch-action:none}

.sm-dialog{width:min(92vw,420px);max-height:min(80vh,560px);display:flex;flex-direction:column;background:var(--dsw-specific-panel-fill,#f5f6f8);color:var(--dsw-alias-label-primary,#17181c);border-radius:20px;box-shadow:0 8px 32px rgba(0,0,0,.18);overflow:hidden;touch-action:auto;animation:sm-pop .2s cubic-bezier(.16,1,.3,1)}

.sm-header{display:flex;align-items:center;justify-content:space-between;padding:16px 18px 10px;flex:none}
.sm-title{font-size:18px;font-weight:800;margin:0;min-width:0;flex:1;letter-spacing:-.3px;color:var(--dsw-alias-label-primary,#17181c)}
.sm-close{width:32px;height:32px;border-radius:10px;background:rgba(128,128,128,.08);border:0;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary,#777b84);cursor:pointer;transition:background .12s ease}
.sm-close:hover{background:rgba(128,128,128,.15)}
.sm-close:active{transform:scale(.92)}

.sm-tabs{display:flex;gap:6px;padding:0 18px 12px;flex:none}
.sm-tab{border:0;background:#e9eaf0;border-radius:10px;padding:7px 14px;font-size:12px;font-weight:600;color:#686c76;cursor:pointer;font-family:inherit;transition:all .12s ease}
.sm-tab:active{transform:scale(.96)}
.sm-tab-on{background:#4f7cff;color:#fff}

.sm-body{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 14px 16px}

.sm-toolbar{display:flex;gap:6px;padding:2px 0 10px;flex-wrap:wrap}
.sm-tool-btn{border:1px solid #e7e8ec;background:#fff;color:#17181c;font:inherit;font-size:11px;font-weight:600;padding:6px 12px;border-radius:10px;cursor:pointer;transition:all .12s ease}
.sm-tool-btn:active{transform:scale(.96);opacity:.85}
.sm-tool-btn:disabled{opacity:.4;cursor:default;transform:none}
.sm-tool-danger{color:#e05252;border-color:rgba(224,82,82,.25)}
.sm-tool-danger:hover{background:rgba(224,82,82,.06)}

.sm-filter{display:flex;gap:6px;padding:2px 0 8px;flex-wrap:wrap}
.sm-filter-btn{border:1px solid #e7e8ec;background:#fff;color:#686c76;font:inherit;font-size:11px;font-weight:600;padding:5px 10px;border-radius:999px;cursor:pointer;transition:all .12s ease}
.sm-filter-btn:active{transform:scale(.96)}
.sm-filter-on{background:#4f7cff;border-color:#4f7cff;color:#fff}

.sm-pull{padding:8px;text-align:center;color:#9ca0aa;font-size:11px}
.sm-pulling{transition:transform .1s ease}

.sm-list{display:flex;flex-direction:column;gap:8px}
.sm-archive-groups{display:flex;flex-direction:column;gap:14px}
.sm-ws-group{display:flex;flex-direction:column;gap:8px}
.sm-ws-header{display:flex;align-items:center;gap:10px;padding:2px 2px 0}
.sm-ws-icon{width:28px;height:28px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex:none;font-size:12px;font-weight:800;line-height:1;background:#eef2ff;color:#4f7cff}
.sm-ws-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.sm-ws-title{font-size:12px;font-weight:700;color:var(--dsw-alias-label-primary,#17181c);line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sm-ws-meta{font-size:10px;color:#777b84;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.sm-card{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:16px;background:#fff;border:1px solid #e7e8ec;box-shadow:0 2px 8px rgba(0,0,0,.03);cursor:pointer;position:relative;transition:transform .12s ease,box-shadow .2s ease,border-color .2s ease;-webkit-tap-highlight-color:transparent;animation:sm-fadein .2s ease-out}
.sm-card-expanded{flex-wrap:wrap;align-items:stretch}
.sm-ws-rows{width:100%;display:flex;flex-direction:column;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid #e7e8ec}
.sm-card:active{transform:scale(.985);box-shadow:0 2px 12px rgba(0,0,0,.06)}
@media(hover:hover){.sm-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.06);border-color:#d0d2d8}}
.sm-card-selected{background:#f0f4ff;border-color:rgba(79,124,255,.25);box-shadow:0 2px 12px rgba(79,124,255,.06)}
.sm-card-current{background:#f8f9fb;border-color:#e7e8ec}

.sm-cb{width:16px;height:16px;flex:none;margin-top:2px;accent-color:#4f7cff}

.sm-card-icon{width:36px;height:36px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex:none;font-size:15px;font-weight:800;line-height:1;overflow:hidden}
.sm-card-icon-img,.sm-ws-icon-img{width:100%;height:100%;object-fit:contain;display:block;border-radius:inherit}

.sm-card-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.sm-card-title{font-size:13px;font-weight:700;color:var(--dsw-alias-label-primary,#17181c);line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sm-card-meta{font-size:10px;color:#777b84;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sm-card-preview{font-size:11px;color:#777b84;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;margin-top:1px}
.sm-card-preview-sub{opacity:.7}
.sm-card-miss{font-size:11px;color:#9ca0aa;font-style:italic;margin-top:1px}

.sm-card-right{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex:none}
.sm-card-time{font-size:10px;color:#9ca0aa;font-variant-numeric:tabular-nums;white-space:nowrap}
.sm-card-hint{font-size:9px;font-weight:600;color:#4f7cff;background:rgba(79,124,255,.08);padding:2px 6px;border-radius:6px;white-space:nowrap}
.sm-card-action{border:0;background:transparent;padding:4px;border-radius:8px;cursor:pointer;color:#9ca0aa;transition:all .12s ease;display:flex;align-items:center;justify-content:center}
.sm-card-action:hover{background:rgba(128,128,128,.08);color:#777b84}
.sm-card-action:active{transform:scale(.88)}
.sm-card-action:disabled{opacity:.3;cursor:default;transform:none}
.sm-card-action-ok{color:#35b56b}
.sm-card-action-ok:hover{background:rgba(53,181,107,.08);color:#2a8c4a}

.sm-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;color:#9ca0aa;font-size:13px;gap:8px;text-align:center}
.sm-loading{padding:32px;text-align:center;color:#9ca0aa;font-size:13px}
.sm-error{padding:10px 14px;background:rgba(224,82,82,.08);border-radius:10px;color:#e05252;margin-bottom:10px;font-size:12px}

@media(prefers-color-scheme:dark){
.sm-dialog{background:#1e222a;color:#f2f4f8}
.sm-title{color:#f2f4f8}
.sm-close{background:rgba(255,255,255,.08);color:#9ca0aa}
.sm-close:hover{background:rgba(255,255,255,.14)}
.sm-tab{background:#2e3340;color:#8b91a0}
.sm-tab-on{background:#4f7cff;color:#fff}
.sm-tool-btn{background:#262a33;border-color:#363c48;color:#d3d7e0}
.sm-filter-btn{background:#262a33;border-color:#363c48;color:#8b91a0}
.sm-filter-on{background:#4f7cff;border-color:#4f7cff;color:#fff}
.sm-pull{color:#6b7080}
.sm-ws-icon{background:rgba(79,124,255,.18);color:#8ba4ff}
.sm-ws-title{color:#f2f4f8}
.sm-ws-meta{color:#8b91a0}
.sm-card{background:#262a33;border-color:#363c48}
.sm-card:active{box-shadow:0 2px 12px rgba(0,0,0,.2)}
.sm-card-selected{background:rgba(79,124,255,.12);border-color:rgba(79,124,255,.3)}
.sm-card-current{background:#1e222a;border-color:#363c48}
.sm-card-title{color:#f2f4f8}
.sm-card-meta{color:#8b91a0}
.sm-card-preview{color:#8b91a0}
.sm-card-time{color:#6b7080}
.sm-tool-danger{color:#ff6b6b;border-color:rgba(255,107,107,.25)}
.sm-error{background:rgba(255,107,107,.1);color:#ff6b6b}
}
`

    function injectStyle () {
      if (typeof document === 'undefined') return () => {}
      const ATTR = 'data-dsh-session-manager'
      const existing = document.querySelector('style[' + ATTR + ']')
      if (existing) { existing.textContent = CSS; return () => existing.remove() }
      const tag = document.createElement('style')
      tag.setAttribute(ATTR, '')
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => tag.remove()
    }

    const inject = ['slots', 'locale', 'layout']

    function apply (ctx) {
      const removeStyle = injectStyle()
      ctx.effect(() => {
        ctx.locale.register(NS, { zh, en })
        return () => { if (ctx.locale.unregister) ctx.locale.unregister(NS); removeStyle(); openSidebar = null }
      }, 'dsh-session-manager: locale')

      ctx.slots.inject('sidebar.footer.action', () => {
        return ctx.slots.register({ name: 'sidebar.footer.action', id: 'dsh-session-manager', order: 10, locale: NS }, SidebarAction)
      })

      ctx.slots.inject('shell.overlay', () => {
        return ctx.slots.register({ name: 'shell.overlay', id: 'dsh-session-manager', order: 10, locale: NS }, Overlay)
      })
    }

    return { inject, apply }
  }
})
