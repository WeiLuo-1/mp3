#!/usr/bin/env python3
import sys
import getopt
import http.client
import urllib.parse
import json
import time

def usage():
    print("dbClean.py -u <baseurl> -p <port>")

def getItems(conn, endpoint):
    """Fetch all IDs from /api/users or /api/tasks"""
    conn.request("GET", f"/api/{endpoint}")
    response = conn.getresponse()
    data = response.read().decode()
    try:
        d = json.loads(data)
        if isinstance(d, dict) and "data" in d and d["data"]:
            return [str(item["_id"]) for item in d["data"]]
    except Exception:
        print(f"[WARN] Could not parse response for {endpoint}: {data}")
    return []

def deleteItem(conn, endpoint, item_id):
    """Send DELETE request and report status"""
    conn.request("DELETE", f"/api/{endpoint}/{item_id}")
    response = conn.getresponse()
    status = response.status
    body = response.read().decode()
    if status in (200, 204):
        print(f"Deleted {endpoint[:-1]} {item_id}")
        return True
    else:
        print(f"[ERROR] Failed to delete {endpoint[:-1]} {item_id}: {status} {body}")
        return False

def main(argv):
    baseurl = "localhost"
    port = 4000

    try:
        opts, _ = getopt.getopt(argv, "hu:p:", ["url=", "port="])
    except getopt.GetoptError:
        usage()
        sys.exit(2)
    for opt, arg in opts:
        if opt == "-h":
            usage()
            sys.exit()
        elif opt in ("-u", "--url"):
            baseurl = str(arg)
        elif opt in ("-p", "--port"):
            port = int(arg)

    conn = http.client.HTTPConnection(baseurl, port)

    # --- Delete users ---
    users = getItems(conn, "users")
    if not users:
        print("No users found.")
    while users:
        for uid in users:
            deleteItem(conn, "users", uid)
            time.sleep(0.1)
        users = getItems(conn, "users")

    # --- Delete tasks ---
    tasks = getItems(conn, "tasks")
    if not tasks:
        print("No tasks found.")
    while tasks:
        for tid in tasks:
            deleteItem(conn, "tasks", tid)
            time.sleep(0.1)
        tasks = getItems(conn, "tasks")

    conn.close()
    print(f"✅ All users and tasks removed at {baseurl}:{port}")

if __name__ == "__main__":
    main(sys.argv[1:])
