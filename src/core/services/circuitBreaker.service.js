import CircuitBreaker from 'opossum';
import dotenv from 'dotenv';

dotenv.config();

class CircuitBreakerService {
    constructor() {
        this.breakers = new Map();
        this.options = {
            timeout: 30000,
            errorThresholdPercentage: 50,
            resetTimeout: 30000,
            volumeThreshold: 5
        };
    }

    getBreaker(name, options = {}) {
        if (!this.breakers.has(name)) {
            const breaker = new CircuitBreaker(async (...args) => {
                const fn = options.fn;
                return fn ? fn(...args) : Promise.resolve(null);
            }, { ...this.options, ...options });

            breaker.on('open', () => {
                console.warn(`[CircuitBreaker] ${name} opened`);
            });

            breaker.on('close', () => {
                console.log(`[CircuitBreaker] ${name} closed`);
            });

            breaker.on('halfOpen', () => {
                console.log(`[CircuitBreaker] ${name} half-open`);
            });

            this.breakers.set(name, breaker);
        }
        return this.breakers.get(name);
    }

    async fire(name, options = {}, ...args) {
        const breaker = this.getBreaker(name, options);
        try {
            return await breaker.fire(...args);
        } catch (err) {
            if (breaker.status?.states?.open) {
                console.error(`[CircuitBreaker] ${name} is open, using fallback`);
                if (options.fallback) {
                    return typeof options.fallback === 'function'
                        ? options.fallback(...args)
                        : options.fallback;
                }
            }
            throw err;
        }
    }

    isOpen(name) {
        const breaker = this.breakers.get(name);
        return breaker?.status?.states?.open || false;
    }

    reset(name) {
        const breaker = this.breakers.get(name);
        if (breaker) {
            breaker.close();
        }
    }

    getStatus(name) {
        const breaker = this.breakers.get(name);
        return breaker?.status || null;
    }
}

export default new CircuitBreakerService();