"""The instance name is written into every scan's meta (engine/scan.py, engine/__main__.py). It must not say
"demo": the production engine runs from config/demo.json (the file name is kept so deployed jobs and the
`--config` default keep working). Reads the config only: no output/ or data/, so the scheduled refresh stays hermetic."""
from engine.config import load


def test_instance_is_not_demo():
    cfg = load("config/demo.json")
    assert cfg.instance == "kismet"
