import os
import subprocess
import sys

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    ps1_path = os.path.join(script_dir, "generate_icons.ps1")
    if os.path.exists(ps1_path):
        cmd = ["powershell", "-ExecutionPolicy", "Bypass", "-File", ps1_path]
        subprocess.check_call(cmd)
    else:
        print("generate_icons.ps1 not found")

if __name__ == "__main__":
    main()
