import subprocess as process
from os import system as shell


def handler(workspace_id=None):
    shell("echo unsafe")
    return process.run(["echo", "unsafe"])
