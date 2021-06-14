#!/bin/bash

GOHA_SERVICE_NAME="goha" 

reset=$(tput sgr0)
red=$(tput setaf 9)
green=$(tput setaf 76)
gray=$(tput setaf 7)
print_success() {
  printf "${green}✔ %s${reset}\n" "$@"
}
print_error() {
  printf "${red}%s${reset}\n" "$@"
}

# Check if the command is executed as sudo
if [ `whoami` != root ]; then
  print_error "Please run this script as root or using sudo"
  exit 1
fi

#################################################################

if [[ $0 = "start" ]]
then

  echo "Starting the proxy ..."
  systemctl start $GOHA_SERVICE_NAME

elif [[ $0 = "stop" ]]
then

  echo "Stopping proxy ..."
  systemctl stop $GOHA_SERVICE_NAME

elif [[ $0 = "log" ]]
then

  journalctl -n 500 -f -u $GOHA_SERVICE_NAME

elif [[ $0 = "reload" ]]
then

  echo "Send reload signal HUP"
  systemctl kill -s HUP --kill-who=main $GOHA_SERVICE_NAME
  # Then print some log for 10 seconds
  journalctl -n 500 -f -u $GOHA_SERVICE_NAME | grep INFO &
  sleep 10
  kill "$!"  # $! =  process ID of the most recently started background process

elif [[ $0 = "restart" ]]
then

  echo "Retarting proxy ..."
  systemctl restart $GOHA_SERVICE_NAME

else

  echo "Unknown command"

fi
