"""Service registry and SLO catalogue fixtures. Idempotent."""

from sqlalchemy.orm import Session

from app.models.sre import Service, Slo

ORDER = 40

SERVICES = [
    ("booking-api", 1, "squad-retail", "4.12.0", ["/api/bookings"], "booking"),
    ("payments-api", 1, "squad-payments", "3.7.2", ["/api/payments"], "payments"),
    ("checkin-api", 1, "squad-airport", "2.9.1", ["/api/checkin"], "checkin"),
    ("flights-search", 2, "squad-shopping", "5.1.0", ["/api/flights"], "flights"),
    (
        "notifications-worker",
        2,
        "squad-comms",
        "1.14.3",
        ["/api/notifications"],
        "notifications",
    ),
    ("loyalty-api", 2, "squad-loyalty", "2.2.0", ["/api/loyalty"], "loyalty"),
    ("irrops-api", 1, "squad-ops", "3.0.4", ["/api/irrops"], "irrops"),
]

SLOS = [
    (
        "booking-availability",
        "booking-api",
        "Booking API availability",
        "availability",
        99.5,
        30,
        None,
    ),
    ("checkout-latency", "payments-api", "Checkout p95 under 800 ms", "latency", 99.0, 30, 800.0),
    (
        "checkin-availability",
        "checkin-api",
        "Check-in availability",
        "availability",
        99.9,
        30,
        None,
    ),
    ("search-latency", "flights-search", "Search p95 under 400 ms", "latency", 99.0, 7, 400.0),
    (
        "notifications-availability",
        "notifications-worker",
        "Notification delivery availability",
        "availability",
        99.0,
        30,
        None,
    ),
    (
        "irrops-availability",
        "irrops-api",
        "Irregular-ops availability",
        "availability",
        99.5,
        30,
        None,
    ),
]


def seed(db: Session) -> None:
    for name, tier, owner, version, endpoints, chaos_target in SERVICES:
        service = db.get(Service, name)
        if service is None:
            db.add(
                Service(
                    name=name,
                    tier=tier,
                    owner=owner,
                    version=version,
                    endpoints_csv=",".join(endpoints),
                    chaos_target=chaos_target,
                )
            )

    for slo_id, service_name, label, kind, objective, window_days, threshold_ms in SLOS:
        if db.get(Slo, slo_id) is None:
            db.add(
                Slo(
                    id=slo_id,
                    service=service_name,
                    name=label,
                    kind=kind,
                    objective_pct=objective,
                    window_days=window_days,
                    threshold_ms=threshold_ms,
                )
            )
    db.commit()
