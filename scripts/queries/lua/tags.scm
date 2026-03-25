(function_declaration
  name: (identifier) @name.definition.function) @definition.function

(function_declaration
  name: (dot_index_expression) @name.definition.method) @definition.method

(assignment_statement
  (variable_list
    name: (identifier) @name.definition.function)
  (expression_list
    value: (function_definition))) @definition.function
