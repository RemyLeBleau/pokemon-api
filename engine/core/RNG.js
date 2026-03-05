// Simple deterministic RNG for testing
class RNG {
  constructor(seed = Date.now()) {
    this.seed = seed % 2147483647;
    if (this.seed <= 0) this.seed += 2147483646;
  }

  next() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed;
  }

  int(min, max) {
    return min + (this.next() % (max - min + 1));
  }

  float() {
    return (this.next() - 1) / 2147483646;
  }
}

module.exports = RNG;