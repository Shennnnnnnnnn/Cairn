"""A deliberately flawed in-memory delivery queue for the local benchmark."""
class Queue:
    def __init__(self):
        self.jobs = []
        self.seen = {}
        self.next_id = 1

    def enqueue(self, tenant, request_id, payload, now):
        if request_id in self.seen:
            return self.seen[request_id].copy()
        job = dict(id=f"job-{self.next_id}", tenant=tenant,
                   request_id=request_id, payload=payload, state="queued",
                   available_at=now, attempts=0, lease_token=None,
                   lease_until=None, worker=None)
        self.next_id += 1
        self.jobs.append(job)
        self.seen[request_id] = job
        return job.copy()

    def reserve(self, worker, now, lease_seconds=30):
        for job in self.jobs:
            if (job['state'] == 'queued' and job['available_at'] <= now
                or job['state'] == 'leased' and job['lease_until'] <= now):
                job.update(state='leased', worker=worker,
                           lease_token=f"{job['id']}:{worker}",
                           lease_until=now+lease_seconds,
                           attempts=job['attempts']+1)
                return job.copy()
        return None

    def ack(self, job_id, token, now):
        for job in self.jobs:
            if job['id'] == job_id and job['lease_token'] == token:
                job['state'] = 'done'
                return True
        return False

    def fail(self, job_id, token, now, delay=0):
        for job in self.jobs:
            if job['id'] == job_id and job['lease_token'] == token:
                job.update(state='queued', available_at=now+delay)
                return True
        return False

    def snapshot(self):
        return dict(version=1, next_id=self.next_id, jobs=self.jobs.copy())

    @classmethod
    def from_snapshot(cls, snapshot):
        queue = cls()
        queue.jobs = snapshot['jobs'].copy()
        return queue
