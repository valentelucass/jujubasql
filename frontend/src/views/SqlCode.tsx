import { useEffect, useRef, type RefObject } from 'react'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { MSSQL, SQLDialect, sql } from '@codemirror/lang-sql'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { tags } from '@lezer/highlight'

const dialect = SQLDialect.define({
  ...MSSQL.spec,
  charSetCasts: true,
  builtin: [
    MSSQL.spec.builtin, 'cast convert try_cast try_convert count coalesce nullif iif',
    'isnull getdate sysdatetime dateadd datediff datepart concat string_agg row_number',
  ].join(' '),
})

const colors = HighlightStyle.define([
  { tag: tags.comment, class: 'sql-comment' },
  { tag: tags.keyword, class: 'sql-keyword' },
  { tag: tags.standard(tags.name), class: 'sql-function' },
  { tag: tags.typeName, class: 'sql-type' },
  { tag: tags.special(tags.name), class: 'sql-variable' },
  { tag: tags.special(tags.string), class: 'sql-identifier' },
  { tag: tags.string, class: 'sql-string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'sql-literal' },
  { tag: tags.operator, class: 'sql-operator' },
])

export function SqlCode({ source, onChange, form }: {
  source: string
  onChange: (value: string) => void
  form: RefObject<HTMLFormElement | null>
}) {
  const parent = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  useEffect(() => {
    if (!parent.current) return
    const editor = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        extensions: [
          lineNumbers(), history(), sql({ dialect }), syntaxHighlighting(colors),
          EditorView.contentAttributes.of({ 'aria-labelledby': 'sql-code-label', spellcheck: 'false' }),
          EditorState.changeFilter.of((transaction) => transaction.newDoc.length <= 32768),
          keymap.of([
            { key: 'Mod-Enter', run: () => { form.current?.requestSubmit(); return true } },
            ...defaultKeymap, ...historyKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChange(update.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = editor
    return () => { view.current = null; editor.destroy() }
  }, [form, onChange])

  useEffect(() => {
    const editor = view.current
    if (editor && editor.state.doc.toString() !== source) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: source } })
    }
  }, [source])

  return <div className="sql-code-editor" ref={parent} />
}
