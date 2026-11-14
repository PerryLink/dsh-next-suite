const calculator = {
  eval: (expression) => Number(expression),
}

export function score(input) {
  const machine = { env: "test" }
  const evaluate = (value) => value * 2
  return evaluate(calculator.eval(input)) + machine.env.length
}
