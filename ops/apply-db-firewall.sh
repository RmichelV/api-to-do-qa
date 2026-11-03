#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=/opt/api-to-do-qa/.env.production
CHAIN=API_TO_DO_QA_DB_ALLOWLIST
PUBLIC_INTERFACE=eth0

if [[ ! -r "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

allowed_ips="$(sed -n 's/^DB_ALLOWED_IPS=//p' "$ENV_FILE" | tail -n 1)"
if [[ -z "$allowed_ips" ]]; then
  echo "DB_ALLOWED_IPS must contain at least one IPv4 address or CIDR" >&2
  exit 1
fi

IFS=',' read -r -a ip_list <<< "$allowed_ips"
for index in "${!ip_list[@]}"; do
  ip="${ip_list[$index]//[[:space:]]/}"
  if [[ "$ip" == */* ]]; then
    address="${ip%/*}"
    prefix="${ip#*/}"
    if [[ ! "$prefix" =~ ^[0-9]{1,2}$ ]] || ((10#$prefix > 32)); then
      echo "Invalid IPv4 CIDR in DB_ALLOWED_IPS" >&2
      exit 1
    fi
  else
    address="$ip"
  fi
  if [[ ! "$address" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    echo "Invalid IPv4 address in DB_ALLOWED_IPS" >&2
    exit 1
  fi
  IFS='.' read -r -a octets <<< "$address"
  for octet in "${octets[@]}"; do
    if ((10#$octet > 255)); then
      echo "Invalid IPv4 octet in DB_ALLOWED_IPS" >&2
      exit 1
    fi
  done
  ip_list[$index]="$ip"
done

if ! iptables -nL "$CHAIN" >/dev/null 2>&1; then
  iptables -N "$CHAIN"
fi
iptables -F "$CHAIN"

iptables -A "$CHAIN" -i "$PUBLIC_INTERFACE" -p tcp --dport 3306 -j DROP
for ip in "${ip_list[@]}"; do
  iptables -I "$CHAIN" 1 -i "$PUBLIC_INTERFACE" -p tcp -s "$ip" --dport 3306 -j RETURN
done

iptables -A "$CHAIN" -j RETURN
if ! iptables -C DOCKER-USER -j "$CHAIN" >/dev/null 2>&1; then
  iptables -I DOCKER-USER 1 -j "$CHAIN"
fi