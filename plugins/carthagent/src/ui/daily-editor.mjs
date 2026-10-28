/** OpenTUI 0.5.17 emits an empty event object, not editor contents. */
export function syncDailyEditor(editor, controller) {
  if (editor && typeof editor.plainText === 'string') controller.edit(editor.plainText);
}
