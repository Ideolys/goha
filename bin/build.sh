#!/bin/bash

# This script builds GoHA and add git Tag. It must be called by npm run build

# Get current package version
PACKAGE_VERSION=$(cat package.json | grep "version" | head -1 | awk -F: '{ print $2 }' | sed 's/[",]//g' | tr -d '[[:space:]]')
# Goha binary suffix
GOHA_TAG="$PACKAGE_VERSION"

# Build target
BUILD_TARGET="node14-linux-x64,node14-macos-x64"

# Build name
PACKAGE_VERSION_WITHOUT_DOT="${PACKAGE_VERSION//./-}"
BUILD_PREFIX="./build/goha-$PACKAGE_VERSION_WITHOUT_DOT"

##################################################################
# Declaration of commmon stuff
##################################################################

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
  printf "${red}%s${reset}\n\n" "$@"
}
exit_on_command_error() {
  if [ "$?" != "0" ]; then
    print_error "ERROR:"
    printf "${red}%s${reset}\n" "$@"
    echo ""
    echo "Build stopped"
    exit 1
  fi
}

##################################################################
# Check if the reposiory is clean
##################################################################

print_info "Is repository clean? "

REPO_STATUS=$(git status --porcelain)
if [[ "$REPO_STATUS" = "" ]]; then
  print_success "OK"
else
  print_error "Error"
  print_error "Clean up your repository before publishing"
  exit 1
fi

##################################################################
# Check if git push --tags works
##################################################################

print_info "Is 'git push --tags' working on your machine? "

# I think --dry-run does not work with option --tags
git push --tags --dry-run > /dev/null 2>&1
exit_on_command_error "Cannot push --tags"
print_success "OK"


##################################################################
# Build
##################################################################

print_info "Build $BUILD_PREFIX for targets: $BUILD_TARGET... "

pkg -t $BUILD_TARGET -o $BUILD_PREFIX . > /dev/null 2>&1
exit_on_command_error "Cannot build. Have you installed pkg globally?"

print_success "OK"

##################################################################
# Tag and push
##################################################################

print_info "Tag version... "

git tag $GOHA_TAG
git push origin $GOHA_TAG

print_success "OK"

print_success "Done"
