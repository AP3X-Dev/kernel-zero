import json as codec


async def handler(workspace_id, /, *, request_id):
    match request_id:
        case str() as value:
            return codec.dumps({"request": value, "workspace": workspace_id})
        case _:
            return codec.dumps({"workspace": workspace_id})


class Service:
    def execute(self, *, workspace_id):
        return codec.dumps({"workspace": workspace_id})
