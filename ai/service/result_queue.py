from collections import deque


class ResultQueue:
    def __init__(self, max_size=20):
        self.queue = deque(maxlen=max_size)

    def push(self, item):
        self.queue.append(item)

    def to_list(self):
        return list(self.queue)
