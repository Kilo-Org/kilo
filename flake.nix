{
  description = "Kilo development flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { self, nixpkgs, ... }:
    let
      systems = [
        "aarch64-linux"
        "x86_64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      rev = self.shortRev or self.dirtyShortRev or "dirty";
    in
    {
      devShells = forEachSystem (pkgs: {
        default =
          let
            kilo = pkgs.writeShellScriptBin "kilo" ''
              cd "$KILO_ROOT"
              exec ${pkgs.bun}/bin/bun dev "$@"
            '';
          in
          pkgs.mkShell {
            packages = with pkgs; [
              bun
              nodejs_20
              pkg-config
              openssl
              git
              gh
              playwright-driver.browsers
              kilo
            ];
            shellHook = ''
              export KILO_ROOT="$PWD"
              export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
              export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true
            '';
          };
      });

      overlays = {
        default =
          final: _prev:
          let
            node_modules = final.callPackage ./nix/node_modules.nix {
              inherit rev;
            };
            opencode = final.callPackage ./nix/opencode.nix {
              inherit node_modules;
            };
            desktop = final.callPackage ./nix/desktop.nix {
              inherit opencode;
            };
          in
          {
            inherit opencode;
            opencode-desktop = desktop;
          };
      };

      packages = forEachSystem (
        pkgs:
        let
          node_modules = pkgs.callPackage ./nix/node_modules.nix {
            inherit rev;
          };
          kilo = pkgs.callPackage ./nix/kilo.nix {
            inherit node_modules;
          };
          desktop = pkgs.callPackage ./nix/desktop.nix {
            inherit kilo;
          };
        in
        {
          default = kilo;
          inherit kilo desktop;
          # Updater derivation with fakeHash - build fails and reveals correct hash
          node_modules_updater = node_modules.override {
            hash = pkgs.lib.fakeHash;
          };
        }
      );
    };
}
