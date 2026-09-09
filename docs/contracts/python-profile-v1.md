# PythonPolicy v1 / PythonEvidence v1

Media types: `application/vnd.kernel-zero.policy+json;version=1` (policy), `application/vnd.kernel-zero.evidence+json;version=1` (evidence).

The closed rule kinds are `forbid-import-edge`, `require-import`, `restrict-call-site`, and `require-context-parameter`. The closed message codes are `PYTHON_IMPORT_DENIED`, `PYTHON_IMPORT_REQUIRED`, `PYTHON_CALL_RESTRICTED`, `PYTHON_CONTEXT_PARAMETER_REQUIRED`, and `PARSE_FAILURE`. Source is parsed locally by CPython 3.11 through 3.14 using the standard-library AST; dynamic runtime behavior is not claimed.
