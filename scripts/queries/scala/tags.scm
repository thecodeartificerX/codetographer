(class_definition
  name: (identifier) @name.definition.class) @definition.class

(object_definition
  name: (identifier) @name.definition.class) @definition.class

(trait_definition
  name: (identifier) @name.definition.interface) @definition.interface

(function_definition
  name: (identifier) @name.definition.function) @definition.function

(val_definition
  pattern: (identifier) @name.definition.function) @definition.function
