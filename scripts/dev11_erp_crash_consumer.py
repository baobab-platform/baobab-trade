"""DEV-11 disposable crash-injection worker: kill process AFTER ERP PG commit,
BEFORE RabbitMQ ACK, to exercise real broker redelivery across processes.

Never deployed as an ERP production consumer; uses the real ERP callback and
PostgreSQL inbox store but injects a crash only in the test runner. This file
cannot start unless the exact disposable CI flags are present.
"""
from __future__ import annotations
import os

import pika
from application.amqp_consumer import _PgStoreContext, delivery_callback

if __name__ == "__main__":
    if (os.environ.get("BAOBAB_ENVIRONMENT") != "development"
            or os.environ.get("BAOBAB_DEV11_RABBIT_CONNECTED_REQUIRED") != "true"
            or os.environ.get("GITHUB_ACTIONS") != "true"):
        raise RuntimeError("DEV11_CRASH_INJECTION_CI_ONLY")
    database = os.environ["DATABASE_URL"]
    secret = os.environ["BAOBAB_EVENT_SIGNING_SECRET"]
    url = os.environ["BAOBAB_RABBITMQ_URL"]
    broker = pika.BlockingConnection(pika.URLParameters(url))
    channel = broker.channel()
    channel.queue_declare(queue="baobab.erp.trade-order.v1", passive=True)
    channel.basic_qos(prefetch_count=1)

    def crash_after_real_commit():
        # Never ACK or fake a successful processing result. The native ERP
        # callback has already committed its actual PostgreSQL inbox receipt.
        # An abrupt OS exit closes the AMQP connection, triggering redelivery.
        os._exit(73)

    channel.basic_consume(
        queue="baobab.erp.trade-order.v1",
        auto_ack=False,
        on_message_callback=lambda ch, method, properties, body:
            delivery_callback(
                ch, method, properties, body,
                store_factory=lambda: _PgStoreContext(database),
                secret=secret,
                after_commit_hook=crash_after_real_commit,
            ),
    )
    channel.start_consuming()
