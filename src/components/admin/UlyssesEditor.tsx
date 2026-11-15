import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorState, Transaction, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, keymap, placeholder, drawSelection, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, isolateHistory } from '@codemirror/commands';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { clipboardImages } from '../../lib/admin/editor-media';
import { paragraphRange } from '../../lib/admin/writing';
import { cleanUploadHistory } from '../../lib/admin/editor-history';

export type WritingPosition = { anchor: number; head: number; scrollTop: number };
export type UlyssesEditorHandle = {
  insert: (text: string) => void;
  focus: () => void;
  replacePlaceholder: (marker: string, text: string) => boolean;
  position: () => WritingPosition | null;
  restore: (position: WritingPosition) => void;
  format: (before: string, after?: string) => void;
};
type Props = {
  value: string;
  onChange: (value: string) => void;
  onImages: (files: File[]) => void;
  onSave: () => void;
  onSelection: (selected: boolean) => void;
  paragraphFocus: boolean;
  typewriter: boolean;
  readOnly: boolean;
  ariaLabel?: string;
  placeholderText?: string;
  maxLength?: number;
  plainText?: boolean;
};

const proseHighlight = HighlightStyle.define([
  { tag: tags.heading1, class: 'writer-h1' },
  { tag: tags.heading2, class: 'writer-h2' },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], class: 'writer-h3' },
  { tag: tags.strong, class: 'writer-strong' },
  { tag: tags.emphasis, class: 'writer-emphasis' },
  { tag: tags.strikethrough, class: 'writer-strike' },
  { tag: tags.link, class: 'writer-link' },
  { tag: tags.url, class: 'writer-url' },
  { tag: [tags.monospace, tags.processingInstruction], class: 'writer-code' },
  { tag: tags.quote, class: 'writer-quote' },
  { tag: [tags.meta, tags.contentSeparator], class: 'writer-syntax' },
]);

function proseDecorations(focus: boolean) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = this.build(update.view);
    }
    build(view: EditorView) {
      const ranges: Range<Decoration>[] = [];
      const active = focus ? paragraphRange(view.state.doc.toString(), view.state.selection.main.head) : null;
      for (const visible of view.visibleRanges) {
        syntaxTree(view.state).iterate({ from: visible.from, to: visible.to, enter(node) {
          if (/^(HeaderMark|EmphasisMark|CodeMark|LinkMark|QuoteMark|ListMark|URL)$/.test(node.name) && node.to > node.from)
            ranges.push(Decoration.mark({ class: 'writer-syntax' }).range(node.from, node.to));
        } });
        if (active) {
          let line = view.state.doc.lineAt(visible.from);
          while (line.from <= visible.to) {
            ranges.push(Decoration.line({ class: line.from >= active.from && line.from <= active.to ? 'writer-paragraph-active' : 'writer-paragraph-dim' }).range(line.from));
            if (line.number === view.state.doc.lines) break;
            line = view.state.doc.line(line.number + 1);
          }
        }
      }
      return Decoration.set(ranges, true);
    }
  }, { decorations: plugin => plugin.decorations });
}

const UlyssesEditor = forwardRef<UlyssesEditorHandle, Props>(function UlyssesEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const current = useRef(props);
  current.current = props;
  const config = useRef(new Compartment());
  const readonly = useRef(new Compartment());
  const external = useRef(false);
  const pendingFocus = useRef(false);
  const completedMarkers = useRef(new Set<string>());
  const recenter = (editor: EditorView) => {
    if (current.current.typewriter && editor.hasFocus && !editor.composing)
      editor.dispatch({ effects: EditorView.scrollIntoView(editor.state.selection.main.head, { y: 'center' }) });
  };
  useImperativeHandle(ref, () => ({
    focus() {
      pendingFocus.current = true;
      if (view.current && !view.current.state.readOnly) { view.current.focus(); pendingFocus.current = false; }
    },
    insert(text) {
      const editor = view.current;
      if (!editor || editor.state.readOnly) return;
      editor.dispatch(editor.state.replaceSelection(text));
      editor.focus();
    },
    replacePlaceholder(marker, text) {
      const editor = view.current;
      if (!editor) return false;
      completedMarkers.current.add(marker);
      const index = editor.state.doc.toString().indexOf(marker);
      if (index < 0) return false;
      editor.dispatch({ changes: { from: index, to: index + marker.length, insert: text }, annotations: [Transaction.userEvent.of('input.upload'), isolateHistory.of('full')] });
      return true;
    },
    position() {
      const editor = view.current;
      return editor ? { anchor: editor.state.selection.main.anchor, head: editor.state.selection.main.head, scrollTop: editor.scrollDOM.scrollTop } : null;
    },
    restore(position) {
      const editor = view.current;
      if (!editor) return;
      const clamp = (value: number) => Math.max(0, Math.min(editor.state.doc.length, value));
      editor.dispatch({ selection: { anchor: clamp(position.anchor), head: clamp(position.head) } });
      editor.requestMeasure({ read: () => position.scrollTop, write: top => { editor.scrollDOM.scrollTop = top; } });
    },
    format(before, after = '') {
      const editor = view.current;
      if (!editor || editor.state.readOnly) return;
      const selection = editor.state.selection.main;
      const text = editor.state.sliceDoc(selection.from, selection.to);
      editor.dispatch({ changes: { from: selection.from, to: selection.to, insert: before + text + after }, selection: { anchor: selection.from + before.length, head: selection.to + before.length } });
      editor.focus();
    },
  }), []);
  useEffect(() => {
    if (!host.current) return;
    let frame = 0;
    const editor = new EditorView({
      parent: host.current,
      dispatchTransactions(transactions, editor) {
        editor.update(transactions.map(transaction => cleanUploadHistory(transaction, completedMarkers.current)));
      },
      state: EditorState.create({ doc: current.current.value, extensions: [
        ...(current.current.plainText ? [] : [markdown()]), history(), drawSelection(), EditorView.lineWrapping,
        EditorState.changeFilter.of(transaction => !transaction.docChanged || !current.current.maxLength || transaction.newDoc.length <= current.current.maxLength || transaction.newDoc.length <= transaction.startState.doc.length),
        syntaxHighlighting(proseHighlight), config.current.of(proseDecorations(current.current.paragraphFocus)),
        readonly.current.of([EditorState.readOnly.of(current.current.readOnly), EditorView.editable.of(!current.current.readOnly)]),
        placeholder(current.current.placeholderText || '从这里开始，写下你的故事…'),
        EditorView.contentAttributes.of({ 'aria-label': current.current.ariaLabel || 'Markdown 正文', spellcheck: 'false', autocapitalize: 'off' }),
        keymap.of([
          { key: 'Mod-s', run: () => { current.current.onSave(); return true; } },
          { key: 'Mod-b', run: () => { if (editor.state.readOnly || current.current.plainText) return true; const { from, to } = editor.state.selection.main; editor.dispatch({ changes: { from, to, insert: '**' + editor.state.sliceDoc(from, to) + '**' }, selection: { anchor: from + 2, head: to + 2 } }); return true; } },
          ...(current.current.plainText ? [] : markdownKeymap), ...defaultKeymap, ...historyKeymap,
        ]),
        EditorView.domEventHandlers({
          paste(event, editor) {
            if (editor.state.readOnly || !event.clipboardData) return false;
            const files = clipboardImages(event.clipboardData);
            if (!files.length) return false;
            event.preventDefault(); current.current.onImages(files); return true;
          },
          drop(event, editor) {
            if (editor.state.readOnly) return false;
            const files = Array.from(event.dataTransfer?.files || []).filter(file => file.type.startsWith('image/'));
            if (!files.length) return false;
            event.preventDefault();
            const position = editor.posAtCoords({ x: event.clientX, y: event.clientY });
            if (position !== null) editor.dispatch({ selection: { anchor: position } });
            current.current.onImages(files); return true;
          },
          compositionend() { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => recenter(editor)); },
        }),
        EditorView.updateListener.of(update => {
          if (update.docChanged && !external.current) current.current.onChange(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) {
            current.current.onSelection(!update.state.selection.main.empty);
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => recenter(update.view));
          }
        }),
      ] }),
    });
    view.current = editor;
    return () => { cancelAnimationFrame(frame); editor.destroy(); view.current = null; };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === props.value) return;
    // External recovery/history changes remain plain Markdown. Normal typing never reinitializes the editor.
    external.current = true;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: props.value } });
    external.current = false;
  }, [props.value]);
  useEffect(() => { view.current?.dispatch({ effects: config.current.reconfigure(proseDecorations(props.paragraphFocus)) }); }, [props.paragraphFocus]);
  useEffect(() => {
    view.current?.dispatch({ effects: readonly.current.reconfigure([EditorState.readOnly.of(props.readOnly), EditorView.editable.of(!props.readOnly)]) });
    if (!props.readOnly && pendingFocus.current && view.current) { view.current.focus(); pendingFocus.current = false; }
  }, [props.readOnly]);
  useEffect(() => { if (view.current) recenter(view.current); }, [props.typewriter]);
  return <div ref={host} className={`ulysses-editor${props.typewriter ? ' writer-typewriter' : ''}`} />;
});
export default UlyssesEditor;
