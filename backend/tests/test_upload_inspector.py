from __future__ import annotations

from app.analysis.upload_inspector import extract_upload_metadata, inspect_upload
from tests.conftest import make_lap_csv


def test_extracts_metadata_from_header_lines():
    csv_text = "\n".join(
        [
            "Car: Ferrari 296 GT3",
            "Track: Spa-Francorchamps",
            "Driver: Test Driver",
            "Lap Time: 1:58.321",
            "",
            make_lap_csv(),
        ]
    )

    metadata = extract_upload_metadata("spa_run.csv", csv_text)

    assert metadata["car_name"] == "Ferrari 296 GT3"
    assert metadata["track_name"] == "Spa-Francorchamps"
    assert metadata["driver_name"] == "Test Driver"
    assert metadata["lap_time"] == 118321


def test_extracts_car_and_track_from_filename():
    metadata = extract_upload_metadata("Ferrari 296 GT3 at Spa-Francorchamps 1_58.321.csv", make_lap_csv())

    assert metadata["car_name"] == "Ferrari 296 GT3"
    assert metadata["track_name"] == "Spa-Francorchamps"
    assert metadata["lap_time"] == 118321


def test_inspect_upload_validates_csv():
    result = inspect_upload("test.csv", make_lap_csv())

    assert result["valid"] is True
    assert result["sample_count"] > 0
    assert "LapDistPct" in result["columns"]
