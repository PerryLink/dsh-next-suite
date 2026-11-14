export function compileRule(expression) {
  // Deliberately dynamic: this fixture exercises the language-level eval path.
  const rule = new Function("value", `return (${expression})`)
  return (value) => Boolean(rule(value))
}

export function runSnippet(snippet) {
  return eval(snippet)
}
