"""Dependency-free CPython AST adapter for the KERNEL ZERO Python profile."""

from __future__ import annotations

import ast
import json
import platform
import sys
from typing import Any

PROTOCOL = "kernel-zero.python-analysis/v1"


def location(node: ast.AST) -> dict[str, int]:
    start_line = max(1, int(getattr(node, "lineno", 1)))
    start_column = max(1, int(getattr(node, "col_offset", 0)) + 1)
    end_line = max(start_line, int(getattr(node, "end_lineno", start_line)))
    end_column = max(start_column, int(getattr(node, "end_col_offset", start_column - 1)) + 1)
    return {
        "endColumn": end_column,
        "endLine": end_line,
        "startColumn": start_column,
        "startLine": start_line,
    }


def syntax_location(error: SyntaxError) -> dict[str, int]:
    start_line = max(1, int(error.lineno or 1))
    start_column = max(1, int(error.offset or 1))
    end_line = max(start_line, int(error.end_lineno or start_line))
    end_column = max(start_column, int(error.end_offset or start_column))
    return {
        "endColumn": end_column,
        "endLine": end_line,
        "startColumn": start_column,
        "startLine": start_line,
    }


def dotted_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        owner = dotted_name(node.value)
        return None if owner is None else f"{owner}.{node.attr}"
    return None


class FactVisitor(ast.NodeVisitor):
    def __init__(self) -> None:
        self.alias_scopes: list[dict[str, str]] = [{}]
        self.name_stack: list[str] = []
        self.imports: list[dict[str, Any]] = []
        self.calls: list[dict[str, Any]] = []
        self.functions: list[dict[str, Any]] = []

    @property
    def aliases(self) -> dict[str, str]:
        return self.alias_scopes[-1]

    def resolve(self, name: str) -> str:
        head, separator, tail = name.partition(".")
        target = self.aliases.get(head, head)
        return target if not separator else f"{target}.{tail}"

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self.imports.append({"module": alias.name, "location": location(node)})
            local = alias.asname or alias.name.split(".", 1)[0]
            self.aliases[local] = alias.name if alias.asname else local

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = f"{'.' * node.level}{node.module or ''}"
        self.imports.append({"module": module, "location": location(node)})
        for alias in node.names:
            if alias.name == "*":
                continue
            local = alias.asname or alias.name
            self.aliases[local] = f"{module}.{alias.name}" if module else alias.name

    def visit_Call(self, node: ast.Call) -> None:
        name = dotted_name(node.func)
        if name is not None:
            self.calls.append({"callee": self.resolve(name), "location": location(node.func)})
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._visit_function(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._visit_function(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        for decorator in node.decorator_list:
            self.visit(decorator)
        self._visit_type_parameters(node)
        for base in node.bases:
            self.visit(base)
        for keyword in node.keywords:
            self.visit(keyword)
        self.name_stack.append(node.name)
        self.alias_scopes.append(dict(self.aliases))
        for statement in node.body:
            self.visit(statement)
        self.alias_scopes.pop()
        self.name_stack.pop()

    def _visit_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        qualified_name = ".".join([*self.name_stack, node.name])
        self.functions.append({
            "location": location(node),
            "name": qualified_name,
            "parameters": parameters(node.args),
        })
        for decorator in node.decorator_list:
            self.visit(decorator)
        for default in [*node.args.defaults, *(item for item in node.args.kw_defaults if item is not None)]:
            self.visit(default)
        signature_arguments = [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]
        if node.args.vararg is not None:
            signature_arguments.append(node.args.vararg)
        if node.args.kwarg is not None:
            signature_arguments.append(node.args.kwarg)
        for argument in signature_arguments:
            if argument.annotation is not None:
                self.visit(argument.annotation)
        if node.returns is not None:
            self.visit(node.returns)
        self._visit_type_parameters(node)
        self.name_stack.append(node.name)
        self.alias_scopes.append(dict(self.aliases))
        for statement in node.body:
            self.visit(statement)
        self.alias_scopes.pop()
        self.name_stack.pop()

    def _visit_type_parameters(self, node: ast.AST) -> None:
        for type_parameter in getattr(node, "type_params", []):
            self.visit(type_parameter)


def parameters(arguments: ast.arguments) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    positional = [*arguments.posonlyargs, *arguments.args]
    default_start = len(positional) - len(arguments.defaults)
    for index, argument in enumerate(positional):
        kind = "positional-only" if index < len(arguments.posonlyargs) else "positional"
        result.append({"kind": kind, "name": argument.arg, "required": index < default_start})
    if arguments.vararg is not None:
        result.append({"kind": "vararg", "name": arguments.vararg.arg, "required": False})
    for argument, default in zip(arguments.kwonlyargs, arguments.kw_defaults, strict=True):
        result.append({"kind": "keyword-only", "name": argument.arg, "required": default is None})
    if arguments.kwarg is not None:
        result.append({"kind": "kwarg", "name": arguments.kwarg.arg, "required": False})
    return result


def analyze(path: str, source: str) -> dict[str, Any]:
    try:
        tree = ast.parse(source, filename=path, type_comments=True)
    except SyntaxError as error:
        return {"calls": [], "functions": [], "imports": [], "parseError": syntax_location(error), "path": path}
    except ValueError:
        return {"calls": [], "functions": [], "imports": [], "parseError": location(ast.Module()), "path": path}
    visitor = FactVisitor()
    visitor.visit(tree)
    return {
        "calls": sorted(visitor.calls, key=lambda item: (item["location"]["startLine"], item["location"]["startColumn"], item["callee"])),
        "functions": sorted(visitor.functions, key=lambda item: (item["location"]["startLine"], item["location"]["startColumn"], item["name"])),
        "imports": sorted(visitor.imports, key=lambda item: (item["location"]["startLine"], item["location"]["startColumn"], item["module"])),
        "parseError": None,
        "path": path,
    }


def main() -> int:
    if platform.python_implementation() != "CPython":
        raise RuntimeError("CPython is required")
    request = json.load(sys.stdin)
    if not isinstance(request, dict) or set(request) != {"files", "protocolVersion"} or request.get("protocolVersion") != PROTOCOL:
        raise ValueError("invalid analysis request")
    files = request.get("files")
    if not isinstance(files, list) or len(files) > 5000:
        raise ValueError("invalid analysis file list")
    analyzed: list[dict[str, Any]] = []
    for item in files:
        if not isinstance(item, dict) or set(item) != {"path", "source"}:
            raise ValueError("invalid analysis file")
        path = item.get("path")
        source = item.get("source")
        if not isinstance(path, str) or not isinstance(source, str):
            raise ValueError("invalid analysis file values")
        analyzed.append(analyze(path, source))
    version = sys.version_info
    response = {
        "files": analyzed,
        "protocolVersion": PROTOCOL,
        "python": {"implementation": "CPython", "version": [version.major, version.minor, version.micro]},
    }
    json.dump(response, sys.stdout, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # The Node runner owns the public error surface.
        sys.stderr.write(f"python-analyzer: {type(error).__name__}: {error}\n")
        raise SystemExit(2)
