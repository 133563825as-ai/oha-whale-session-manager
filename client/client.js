window.__ModuleLoader__.load({
  id: 'dsh-session-manager',
  factory: (require) => {
    const inject = ['slots', 'locale']
    // UI seats reserved for later registration tasks.
    const seats = ['sidebar.footer.action', 'shell.overlay']

    function apply(ctx) {}

    return { inject, apply }
  }
})
