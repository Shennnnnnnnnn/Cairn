import unittest
from delivery_queue import Queue

class PublicTests(unittest.TestCase):
    def test_enqueue_then_ack(self):
        q = Queue()
        job = q.enqueue('alpha', 'req-1', {'message': 'hello'}, 0)
        leased = q.reserve('worker-a', 0)
        self.assertEqual(leased['id'], job['id'])
        self.assertTrue(q.ack(job['id'], leased['lease_token'], 1))
        self.assertIsNone(q.reserve('worker-b', 2))

    def test_retry_wait(self):
        q = Queue()
        q.enqueue('alpha', 'req-2', {'message': 'hello'}, 0)
        leased = q.reserve('worker-a', 0)
        self.assertTrue(q.fail(leased['id'], leased['lease_token'], 1, delay=10))
        self.assertIsNone(q.reserve('worker-b', 10))
        self.assertEqual(q.reserve('worker-b', 11)['attempts'], 2)

if __name__ == '__main__':
    unittest.main()
