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
...

[files_gateway_taurus_staging]
user@x.x.x.x

...
```

### 2. Update `environment.yaml`

Configure the deployment variables:

```yaml
# Infisical Configuration
infisical_client_id: 'your-client-id'
infisical_secret: 'your-client-secret'
infisical_project_id: 'your-project-id'
```

## Usage

### Deploy to Production

```bash
ansible-playbook -i hosts.ini auto-files-gateway-deployment.yaml \
  -e target_machines=files_gateway_taurus_production \
  -e file_retriever_image_tag=v1.0.0 \
  -e indexer_image_tag=v1.0.0 \
  -e gateway_image_tag=v1.0.0
```

### Deploy to Staging

```bash
ansible-playbook -i hosts.ini auto-files-gateway-deployment.yaml \
  -e target_machines=files_gateway_taurus_staging \
  -e file_retriever_image_tag=staging \
  -e indexer_image_tag=staging \
  -e gateway_image_tag=staging
```

### Deploy with Custom Configuration

```bash
ansible-playbook -i hosts.ini auto-files-gateway-deployment.yaml \ --extra-vars="@custom-vars.yaml"
```

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
