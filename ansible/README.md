# Auto-Files Gateway Deployment

This directory contains Ansible playbooks and configuration files for deploying the Auto-Files Gateway services.

## Files

- `auto-files-gateway-deployment.yaml` - Main Ansible playbook for deployment
- `environment.yaml` - Environment variables and configuration
- `hosts.ini` - Target hosts configuration
- `README.md` - This file

## Prerequisites

1. Install Ansible on your local machine
2. Install Infisical CLI
3. Configure SSH access to target servers
4. Set up Infisical project with required secrets

## Configuration

### 1. Update `hosts.ini`

Add your target servers to the appropriate groups:

```ini
[production]
files-gateway-01 ansible_host=YOUR_SERVER_IP ansible_user=ubuntu

[staging]
files-gateway-staging ansible_host=YOUR_STAGING_IP ansible_user=ubuntu
```

### 2. Update `environment.yaml`

Configure the deployment variables:

```yaml
# Infisical Configuration
infisical_client_id: "your-client-id"
infisical_token: "your-client-secret"
infisical_project_id: "your-project-id"

# Docker Image Tags
file_retriever_image_tag: "latest"
indexer_image_tag: "latest"
gateway_image_tag: "latest"

# Target Machines
target_machines: "production"
```

## Usage

### Deploy to Production

```bash
ansible-playbook -i hosts.ini auto-files-gateway-deployment.yaml \
  -e target_machines=production \
  -e file_retriever_image_tag=v1.0.0 \
  -e indexer_image_tag=v1.0.0 \
  -e gateway_image_tag=v1.0.0
```

### Deploy to Staging

```bash
ansible-playbook -i hosts.ini auto-files-gateway-deployment.yaml \
  -e target_machines=staging \
  -e file_retriever_image_tag=staging \
  -e indexer_image_tag=staging \
  -e gateway_image_tag=staging
```

### Deploy with Custom Configuration

```bash
ansible-playbook -i hosts.ini auto-files-gateway-deployment.yaml \
  --extra-vars="@custom-vars.yaml"
```

## Required Infisical Secrets

The deployment script expects these secrets to be configured in Infisical:

- `FILE_RETRIEVER_DOCKER_TAG`
- `OBJECT_MAPPING_INDEXER_DOCKER_TAG`
- `GATEWAY_DOCKER_TAG`
- All environment variables required by the services

## Troubleshooting

1. **Connection Issues**: Ensure SSH access to target servers
2. **Infisical Issues**: Verify client ID, secret, and project ID
3. **Docker Issues**: Check if Docker is installed on target servers
4. **Permission Issues**: Ensure user has sudo access on target servers

## Security Notes

- Store sensitive variables in Ansible Vault or Infisical
- Use SSH key authentication
- Ensure proper firewall configuration
- Regular backup of environment files