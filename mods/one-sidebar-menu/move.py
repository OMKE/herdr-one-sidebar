import base64
import json
import os
import shutil
import subprocess
import sys
import time

HERDR = shutil.which("herdr-app") or "/Applications/Herdr.app/Contents/MacOS/Herdr"


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def do(command, **args):
    out = subprocess.run([HERDR, "do", command, json.dumps(args)], capture_output=True, text=True, timeout=30)
    log(f"{command} {json.dumps(args)} -> {out.stdout.strip()} {out.stderr.strip()}".replace("\n", " "))
    return out


def ls():
    out = subprocess.run([HERDR, "ls"], capture_output=True, text=True, timeout=30)
    return json.loads(out.stdout)


def where(terminal):
    for s in ls()["spaces"]:
        for t in s["tabs"]:
            if any(x["terminal"] == terminal for x in t["terminals"]):
                return t["id"]
    return None


def active(space):
    return any(s["id"] == space and s.get("active") for s in ls()["spaces"])


def wait(ok, what, limit=15):
    end = time.time() + limit
    while time.time() < end:
        if ok():
            time.sleep(0.3)
            return
        time.sleep(0.15)
    raise RuntimeError(f"timed out waiting for {what}")


def select(space):
    if not active(space):
        do("space.select", id=space)
        wait(lambda: active(space), "the space")


def gather(space, terminals):
    for i, t in enumerate(terminals):
        do("terminal.park", terminal=t)
        wait(lambda: where(t) is None, f"{t} to park")
        select(space)
        if i:
            do("pane.focus", terminal=terminals[i - 1])
            time.sleep(0.3)
            do("terminal.keep", terminal=t, place="right")
        else:
            do("terminal.keep", terminal=t)
        wait(lambda: where(t) is not None, f"{t} to show")
    return where(terminals[0])


def main():
    plan = json.loads(base64.b64decode(sys.argv[1]).decode())
    log(f"plan {json.dumps(plan)}")
    space = plan["space"]
    groups = plan["groups"]
    everyone = [t for g in groups for t in g["terminals"]]
    try:
        select(space)
        if plan["mode"] == "split":
            tab = gather(space, everyone)
            if tab:
                do("tab.rename", id=tab, name=" | ".join(g["name"] for g in groups))
                do("tab.select", id=tab)
        else:
            first = None
            for g in groups:
                tab = gather(space, g["terminals"])
                if tab and g["name"]:
                    do("tab.rename", id=tab, name=g["name"])
                first = first or tab
            if first:
                do("tab.select", id=first)
        log("done")
    except Exception as err:
        log(f"error {err}")
        names = {t: g["name"] for g in groups for t in g["terminals"]}
        for t in everyone:
            if where(t) is None:
                try:
                    select(space)
                    do("terminal.keep", terminal=t)
                    wait(lambda: where(t) is not None, f"{t} back")
                    if names[t]:
                        do("tab.rename", id=where(t), name=names[t])
                except Exception as again:
                    log(f"restore failed {t} {again}")
        sys.exit(1)


if __name__ == "__main__":
    main()
