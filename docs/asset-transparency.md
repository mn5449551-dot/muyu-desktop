# Asset Transparency Cleanup

Use this when sprite edges look gray/white on pure-color backgrounds.

## Script

```bash
python3 scripts/assets/decontaminate-alpha.py --input assets/images --strength 0.35 --min-alpha 8 --max-alpha 252
```

## What It Does

- Targets `*_idle.webp` and `*_hit.webp` under `assets/images`.
- Keeps alpha channel unchanged.
- Lightly removes white matte contamination from semi-transparent edge pixels.
- Creates backup files at `assets/images/_backup_before_decontaminate/`.

## Recommended Flow

1. Run the script after importing new role images.
2. Check characters on white and dark backgrounds.
3. If edges look too hard, reduce `--strength` (for example `0.25`).
