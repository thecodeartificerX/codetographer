(call
  target: (identifier) @_defm
  (arguments
    (identifier) @name.definition.function)
  (#match? @_defm "^def(p|macro|macrop)?$")) @definition.function

(call
  target: (identifier) @_defm
  (arguments
    (call
      target: (identifier) @name.definition.function))
  (#match? @_defm "^def(p|macro|macrop)?$")) @definition.function

(call
  target: (identifier) @_defmodule
  (arguments
    (alias) @name.definition.module)
  (#eq? @_defmodule "defmodule")) @definition.module
