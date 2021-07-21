#!/bin/bash

# Accepts these external variables
# NON_INTERACTIVE    : false by default. Set true to run this script without interaction
# GOHA_WORKDIR       : installation directory
# GOHA_USER          : goha user

reset=$(tput sgr0)
red=$(tput setaf 9)
green=$(tput setaf 76)
gray=$(tput setaf 7)
print_info() {
  printf "${gray}%s${reset}" "$@"
}
print_success() {
  printf "${green}✔ %s${reset}\n" "$@"
}
print_error() {
  printf "${red}%s${reset}\n" "$@"
}
exit_on_command_error() {
  if [ "$?" != "0" ]; then
    print_error "ERROR:"
    printf "${red}%s${reset}\n" "$@"
    echo ""
    echo "Installation stopped"
    exit 1
  fi
}

if [ `whoami` != root ]; then
  print_error "Please run this script as root or using sudo"
  exit 1
fi

while (( $# )); do
  case "$1" in
    --non-interactive) NON_INTERACTIVE=true ;;
    --no-start) NO_START=true ;;
    *)
    break ;;
  esac
  shift
done

# Replace "sed" command by an OS specific command "sed_i". Why?
# The GNU version of sed allows you to use "-i" without an argument. The FreeBSD/Mac OS X does not.
# Source: http://www.grymoire.com/Unix/Sed.html#uh-62h
case $(sed --help 2>&1) in
  *GNU*) sed_i () { 
    sed -i "$@";
    exit_on_command_error "Cannot execute sed with $@"
  };;
  *) sed_i () { 
    sed -i '' "$@"; 
    exit_on_command_error "Cannot execute sed with $@"
  };;
esac

# Assign variables if not already defined
GOHA_USER=${GOHA_USER:="goha"}
GOHA_WORKDIR=${GOHA_WORKDIR:="/var/www/goha"}

if [ ! "$NON_INTERACTIVE" = true ]; then
  echo ""
  echo "Goha installation, data and configuration directory"
  read -p "GOHA_WORKDIR [$GOHA_WORKDIR]: "
  if [ ! -z "$REPLY" ]; then
    GOHA_WORKDIR=$REPLY
  fi
  echo ""
  echo "Goha will be run as user/group"
  read -p "GOHA_USER [$GOHA_USER]: "
  if [ ! -z "$REPLY" ]; then
    GOHA_USER=$REPLY
  fi
fi

# __SOURCE_BINARY_FILE__ is replaced before using this script
BINARY_FILE_PATH="__SOURCE_BINARY_FILE__"
BINARY_FILE="$(basename -- $BINARY_FILE_PATH)"
GOHA_INSTALL_DIR="/usr/local/bin"
GOHA_BIN="goha"
GOHA_BIN_PATH="$GOHA_INSTALL_DIR/$GOHA_BIN"
GOHA_SERVICE_NAME=$GOHA_BIN
SYSTEMD_TEMPLATE="$(dirname "$BINARY_FILE_PATH")/goha-systemd-template" # genarated just efore executing this file
SYSTEMD_SERVICE_PATH="/etc/systemd/system/${GOHA_SERVICE_NAME}.service"

echo $BINARY_FILE_PATH
echo ""
echo "==================================="
echo "GOHA_WORKDIR      = $GOHA_WORKDIR"
echo "GOHA_USER         = $GOHA_USER"
echo "GOHA_BIN          = $GOHA_BIN"
echo "GOHA_BIN_PATH     = $GOHA_BIN_PATH"
echo "GOHA_SERVICE_NAME = $GOHA_SERVICE_NAME"
echo "==================================="
echo ""


if [ ! "$NON_INTERACTIVE" = true ]; then
  read -p "Confirm installation? (y, n=default) " -r
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Installation stopped!"
    exit 1
  fi
  echo ""
fi

# TODO
if systemctl is-active --quiet $GOHA_SERVICE_NAME; then
  print_info "Goha is currently running "
  print_success "OK"
  systemctl status $GOHA_SERVICE_NAME
  exit_on_command_error "Cannot check status of Goha service"
  print_info "Running invisible upgrade "
  print_success "OK"
fi

# Create goha user if necessary
if id $GOHA_USER &>/dev/null; then
  print_info "User $GOHA_USER already exists "
  print_success "OK"
else
  print_info "Create goha user "
  adduser $GOHA_USER --no-create-home --disabled-password --system --group > /dev/null
  exit_on_command_error "Cannot create user $GOHA_USER"
  print_success "OK"
fi

# Create working dir if necessary
if [ ! -d $GOHA_WORKDIR ]; then
  print_info "Create Goha directory "
  mkdir $GOHA_WORKDIR
  exit_on_command_error "Cannot create directory in $GOHA_WORKDIR. Is parent directory exist?"
  print_success "OK"

  print_info "Set directory owner to goha "
  chown -R $GOHA_USER:$GOHA_USER $GOHA_WORKDIR
  exit_on_command_error "Cannot change owner of directory $GOHA_WORKDIR"
  print_success "OK"
fi

# Copy binary installation dir (/usr/local/bin)
if [ $BINARY_FILE_PATH != $GOHA_BIN_PATH ]; then
  print_info "Copy binary in goha install directory "
  cp $BINARY_FILE_PATH $GOHA_INSTALL_DIR
  exit_on_command_error "Cannot copy binary in $GOHA_INSTALL_DIR"
  cd $GOHA_INSTALL_DIR
  # mv crash if filename are the same
  if [ $BINARY_FILE != $GOHA_BIN ]; then
    # mv and create a backup
    mv -b --suffix=.bak $BINARY_FILE $GOHA_BIN
    exit_on_command_error "Cannot rename binary $BINARY_FILE"
  fi
  chmod 755 $GOHA_BIN
  exit_on_command_error "Cannot make it executable"
  print_success "OK"

  # allow execution on port 80 and 443
  setcap 'cap_net_bind_service=+ep' $GOHA_BIN_PATH
fi

#print_info "Change owner of executable "
#chown $GOHA_USER:$GOHA_USER $GOHA_BIN_PATH
#exit_on_command_error "Cannot change owner of $GOHA_BIN_PATH"
#print_success "OK"

print_info "Create or update $GOHA_SERVICE_NAME systemd service "
mv $SYSTEMD_TEMPLATE $SYSTEMD_SERVICE_PATH
exit_on_command_error "Cannot copy ${SYSTEMD_TEMPLATE} to ${SYSTEMD_SERVICE_PATH}. Execute 'goha install' again if ${SYSTEMD_TEMPLATE} does not exit."
print_success "OK"

# Replace path in systemd
print_info "Update $GOHA_SERVICE_NAME systemd file "
sed_i "s/GOHA_SERVICE_NAME/$GOHA_SERVICE_NAME/" "$SYSTEMD_SERVICE_PATH"
# Use "@" instead of "/"" because GOHA_WORKDIR contains slashes
sed_i "s@GOHA_WORKDIR@$GOHA_WORKDIR@" "$SYSTEMD_SERVICE_PATH"
sed_i "s/GOHA_USER/$GOHA_USER/" "$SYSTEMD_SERVICE_PATH"
sed_i "s@GOHA_BIN_PATH@$GOHA_BIN_PATH@" "$SYSTEMD_SERVICE_PATH"
print_success "OK"

print_info "Register service "
systemctl daemon-reload > /dev/null 2>&1
systemctl enable $GOHA_SERVICE_NAME
exit_on_command_error "Cannot reload or enable service $GOHA_SERVICE_NAME"
print_success "OK"
if [ ! "$NO_START" = true ]; then
  print_info "Starting service "
  systemctl start $GOHA_SERVICE_NAME > /dev/null
  print_success "OK"
fi

echo ""
echo "Installation done!"
echo ""
echo "Run "
echo "$GOHA_BIN -h to see what you can do"
