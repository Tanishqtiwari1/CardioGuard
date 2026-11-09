import pytest

from app.database.connection import normalise_database_url


@pytest.mark.parametrize("given,expected", [
    ("postgres://u:p@h/db", "postgresql+psycopg2://u:p@h/db"),
    ("postgresql://u:p@h/db?sslmode=require", "postgresql+psycopg2://u:p@h/db?sslmode=require"),
    ("  postgresql://u:p@h/db\n", "postgresql+psycopg2://u:p@h/db"),
    ("postgresql+psycopg2://u:p@h/db", "postgresql+psycopg2://u:p@h/db"),
    ("sqlite:///Backend/cardioguard.db", "sqlite:///Backend/cardioguard.db"),
])
def test_database_url_names_the_installed_driver(given, expected):
    assert normalise_database_url(given) == expected
