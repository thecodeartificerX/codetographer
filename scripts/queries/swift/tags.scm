(class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

(struct_declaration
  name: (type_identifier) @name.definition.class) @definition.class

(enum_declaration
  name: (type_identifier) @name.definition.enum) @definition.enum

(protocol_declaration
  name: (type_identifier) @name.definition.interface) @definition.interface

(function_declaration
  name: (simple_identifier) @name.definition.function) @definition.function

(init_declaration
  "init" @name.definition.method) @definition.method

(subscript_declaration
  "subscript" @name.definition.method) @definition.method
