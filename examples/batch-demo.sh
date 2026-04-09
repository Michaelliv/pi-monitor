#!/bin/bash
# Demo: 100-step batch processing job with timestamps and random data
# Used in the pi-monitor demo video

for i in $(seq 1 100); do
  echo "$(date +%H:%M:%S) [step $i/100] processing batch $((RANDOM % 1000))... $(head -c 40 /dev/urandom | base64 | head -c 20)"
  sleep 0.3
done
