"""Generate search query variants from postal codes."""

from pathlib import Path
from typing import List

VARIANTS = ["kos di", "kost di", "kosan di"]


def generate_queries(postal_codes: List[int]) -> List[str]:
    queries: List[str] = []
    for code in postal_codes:
        for variant in VARIANTS:
            queries.append(f"{variant} {code}")
    return queries


def write_queries(queries: list[str], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        for q in queries:
            f.write(q + "\n")


def main():
    cengkareng_codes = [11710, 11720, 11730, 11740, 11750]
    queries = generate_queries(cengkareng_codes)
    print(f"Generated {len(queries)} queries for {len(cengkareng_codes)} postal codes")
    for q in queries:
        print(f"  {q}")


if __name__ == "__main__":
    main()
