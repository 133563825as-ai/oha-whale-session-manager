window.__ModuleLoader__.load({
  id: 'dsh-session-manager',
  factory: (require) => {
    const inject = [
      'sidebar.footer.action',
      'shell.overlay'
    ]

    function apply(ctx) {}

    return { inject, apply }
  }
})
