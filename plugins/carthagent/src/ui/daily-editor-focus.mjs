/**
 * Native dialogs resolve before their delayed refocus of the saved renderable.
 * Observe actual action-list focus, then reconcile after focus() has finished
 * installing its input handlers. A fixed timeout from compose can run too early.
 */
export function createDailyEditorFocus({ state, editor, defer = queueMicrotask }) {
  let actions;
  let generation = 0;
  let disposed = false;
  const permissions = () => {
    const current = state();
    const enabled = !disposed && !current.busy && current.mode === 'base';
    return {
      editor: enabled && current.phase === 'edit' && current.hasDraft && current.editorFocus,
      actions: enabled && (current.phase !== 'edit' || !current.editorFocus),
    };
  };
  const reconcile = () => {
    if (disposed) return;
    // Read synchronously too, so a Solid effect subscribes to ownership changes.
    permissions();
    const ticket = ++generation;
    defer(() => {
      if (disposed || ticket !== generation) return;
      // Never capture ownership or the editor across a modal/phase/Tab change.
      const allowed = permissions();
      const input = editor();
      if (!allowed.editor && input && !input.isDestroyed && input.focused) input.blur();
      if (!allowed.actions && actions && !actions.isDestroyed && actions.focused) actions.blur();
      const target = allowed.editor ? input : allowed.actions ? actions : undefined;
      if (target && !target.isDestroyed && !target.focused) target.focus();
    });
  };
  return {
    reconcile,
    editorEnabled: () => permissions().editor,
    actionsEnabled: () => permissions().actions,
    attachActions(renderable) {
      actions?.off('focused', reconcile);
      actions = renderable;
      if (disposed) return;
      actions.on('focused', reconcile);
      reconcile();
    },
    dispose() {
      disposed = true;
      generation++;
      actions?.off('focused', reconcile);
      actions = undefined;
    },
  };
}
